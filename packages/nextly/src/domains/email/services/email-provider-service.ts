/**
 * Email Provider Service
 *
 * CRUD operations for managing email providers stored in the
 * `email_providers` table. Supports SMTP, Resend, and SendLayer
 * providers with default provider management and test sending.
 *
 * Configuration JSON is encrypted at rest using AES-256-GCM.
 * Public-facing methods return masked configuration; internal
 * methods provide decrypted access for email sending.
 *
 * @module services/email/email-provider-service
 * @since 1.0.0
 */

import { randomUUID } from "crypto";
import { isDeepStrictEqual } from "util";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq, desc, ne } from "drizzle-orm";

import type { RequestActor } from "../../../auth/request-actor";
import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import { env } from "../../../lib/env";
import { emailProvidersMysql } from "../../../schemas/email-providers/mysql";
import { emailProvidersPg } from "../../../schemas/email-providers/postgres";
import { emailProvidersSqlite } from "../../../schemas/email-providers/sqlite";
import type {
  EmailProviderInsert,
  EmailProviderRecord,
  EmailProviderType,
} from "../../../schemas/email-providers/types";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { encrypt, decrypt } from "../../../utils/encryption";
// Pull adapter type into a normal `import type` declaration so the return
// signature on createAdapterFromProvider satisfies consistent-type-imports.
import { affectedRowCount } from "../../auth/services/auth-service";
import {
  isRecognisedMessageId,
  mailboxOf,
  messageIdWithoutRecipients,
  refusedMailboxes,
  type EmailDeliveryInput,
} from "../delivery-record";
import {
  changedProviderFields,
  recordProviderActivity,
  type EmailProviderActivityInput,
} from "../provider-activity";
import { describeProviderFailure } from "../provider-definition";
import type { EmailProviderAdapter } from "../types";

import type { EmailDeliveryService } from "./email-delivery-service";
import { getEmailProviderRegistry } from "./email-provider-registry";

const MASKED_VALUE = "••••••••";

/**
 * What a provider means when it returns `{ success: false }` without throwing.
 *
 * One constant because the sentence is both returned to the caller and stored
 * in the delivery row, and a row whose reason disagrees with what the operator
 * was shown is worse than one with no reason at all.
 */
const SEND_RETURNED_UNSUCCESSFUL = "Send returned unsuccessful";

/**
 * What a provider means when it accepts the message and refuses the address.
 *
 * Distinct from the sentence above because the two send an operator to
 * different places: one is the provider or its credentials, the other is the
 * address typed into the test dialog.
 */
const TEST_RECIPIENT_REFUSED = "The provider refused the test recipient";

// ============================================================
// Input Types
// ============================================================

/**
 * Input for creating a new email provider.
 * Extends EmailProviderInsert (all required + optional fields).
 */
export type CreateEmailProviderInput = EmailProviderInsert;

/**
 * Input for updating an existing email provider.
 * All fields are optional — only provided fields are updated.
 * Note: `type` may be changed; the admin supports switching provider on
 * edit. A change re-validates the stored configuration against the new
 * provider, because the rules that accepted it belonged to the old one.
 */
export interface UpdateEmailProviderInput {
  name?: string;
  type?: EmailProviderType;
  fromEmail?: string;
  fromName?: string | null;
  configuration?: Record<string, unknown>;
  /**
   * Configuration paths this update REMOVES, as declared field names.
   *
   * Out of band rather than a marker value inside `configuration`, because a
   * patch merged over stored configuration otherwise has only two states --
   * absent means "leave it", a value means "set it" -- and no way to say
   * "unset it", so an optional field became permanent the moment it was first
   * saved. Clearing it in the form omitted it, and omission is
   * indistinguishable from not touching it.
   *
   * Every in-band alternative collides with real data: a provider's
   * `parseConfig` may legitimately accept `null`, an empty string, or any
   * sentinel string chosen here, and a create already stores those verbatim.
   * A separate list cannot be confused with a value because it does not live
   * in the value space at all.
   *
   * Each entry must name a field the effective provider DECLARES. Anything
   * else is rejected, which also means these strings never become arbitrary
   * object paths.
   */
  unsetConfiguration?: string[];
  isDefault?: boolean;
  isActive?: boolean;
}

// ============================================================
// Email Provider Service
// ============================================================

/** Raw DB row before decryption — configuration may be an encrypted string. */
interface RawEmailProviderRow
  extends Omit<EmailProviderRecord, "configuration"> {
  configuration: Record<string, unknown> | string;
}

/** Union of all dialect-specific email_providers table definitions. */
type EmailProvidersTable =
  | typeof emailProvidersPg
  | typeof emailProvidersMysql
  | typeof emailProvidersSqlite;

/** A provider that held the default until a handover took it away. */
interface DisplacedDefault {
  id: string;
  name: string;
  type: string;
}

/**
 * The transaction-bound query surface a handover needs.
 *
 * `withTransaction` hands its callback a dialect-specific instance typed
 * `unknown`, because naming all three would bind this file to all three driver
 * packages. Narrowing to the two statements a handover actually issues keeps
 * the body typed without an `any`, and keeps the fact that they must run on
 * the TRANSACTION rather than on `this.db` in the type: on Postgres and MySQL
 * `this.db` is a different pooled connection, so a statement sent there would
 * commit on its own and sit outside the rollback.
 */
interface ProviderTransaction {
  select<TSelection extends Record<string, unknown>>(
    fields: TSelection
  ): {
    from(table: EmailProvidersTable): {
      where(condition: unknown): Promise<DisplacedDefault[]>;
    };
  };
  update(table: EmailProvidersTable): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
  insert(table: EmailProvidersTable): {
    values(data: Record<string, unknown>): Promise<unknown>;
  };
}

export class EmailProviderService extends BaseService {
  private emailProviders: EmailProvidersTable;
  private encryptionSecret: string | undefined;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    /**
     * Where a test send is recorded.
     *
     * The Test button dispatches a REAL message, so it belongs in the delivery
     * log for the same reason every other send does: an operator asking "did
     * anything go out" should not have to know which button produced it.
     * Optional, so a missing recorder never prevents a send.
     */
    private readonly deliveries?: EmailDeliveryService
  ) {
    super(adapter, logger);

    this.encryptionSecret = env.NEXTLY_SECRET;

    switch (this.dialect) {
      case "postgresql":
        this.emailProviders = emailProvidersPg;
        break;
      case "mysql":
        this.emailProviders = emailProvidersMysql;
        break;
      case "sqlite":
        this.emailProviders = emailProvidersSqlite;
        break;
      default:
        // `this.dialect` is narrowed to `never` after the exhaustive switch;
        // String() coercion satisfies @typescript-eslint/restrict-template-expressions.
        throw new Error(`Unsupported dialect: ${String(this.dialect)}`);
    }
  }

  // ============================================================
  // Encryption Helpers
  // ============================================================

  /**
   * Encrypt a configuration JSON object for storage.
   *
   * Refuses rather than degrading. A provider's configuration holds SMTP
   * passwords and API keys, so with no secret to encrypt them under the only
   * alternative is to write the credential readable to anyone with database
   * access. `domains/webhooks/secret.ts` already refuses for the same threat;
   * this keeps the two consistent instead of leaving the higher-value
   * credential on the weaker policy.
   *
   * The message names the variable because the operator is one environment
   * setting away from working, and a variable name is not itself a secret.
   */
  /**
   * A provider's configuration, parsed and checked to be storable as it is.
   *
   * Parsing happens HERE rather than at each caller, because every property
   * below is about what may be persisted, and a caller that parsed on its own
   * would be a write that skipped the checks.
   *
   * The parsed value is `unknown` by design — the erased form does not expose
   * the type — so each property is checked rather than assumed.
   */
  private storableConfiguration(
    type: string,
    input: unknown
  ): Record<string, unknown> {
    const provider = getEmailProviderRegistry().get(type);

    // Parsed from an OWN-PROPERTY tree, never from the object as it arrived.
    // Measured on zod 4.1.12: a schema reads a value off the prototype chain
    // and materialises it into its output as an OWN property, and it does so
    // for a REQUIRED field as well as an optional one -- so "it parsed" stops
    // meaning "the caller supplied it". A Direct API caller passing
    // `Object.create({ apiKey })`, or a polluted `Object.prototype`, would
    // otherwise have a credential nobody sent encrypted and persisted, and it
    // stays active after the prototype is restored.
    //
    // `Object.hasOwn` is NOT a usable guard here, because the value is already
    // an own property of the parser's output by the time anything could ask.
    // The serialisation is what removes it: `JSON.stringify` reads own
    // enumerable properties only, so the parser never sees the inherited one.
    const parsed = provider.parseConfiguration(this.ownFieldsOf(type, input));

    // A provider whose parser returns something other than an object cannot
    // have its configuration persisted at all, and failing here names which
    // provider did it; storing the value regardless would put a string or an
    // array in a column every reader expects to hold fields.
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: `Email provider "${type}" parsed its configuration into a ${Array.isArray(parsed) ? "list" : typeof parsed}, and a configuration must be an object of fields. Return the parsed object from \`parseConfig\`.`,
        logContext: { reason: "email-provider-parsed-not-object", type },
      });
    }

    // What an adapter runs on is not this value. It is this value written as
    // JSON into the column, read back, and parsed AGAIN — `createAdapterFrom`
    // re-parses whatever it is handed, which is what keeps an adapter from
    // being built out of a row nothing validated. So the property that has to
    // hold is that parsing the stored form returns the stored form, and it is
    // checked here rather than left as an assumption about how parsers behave.
    //
    // The configuration IS its serialisation, and that is the whole rule the
    // rest of this method follows. A type the column cannot hold is COERCED
    // into the form it can — a `Date` becomes its ISO string, an
    // `undefined`-valued key becomes an absent one — and the coerced form is
    // what everything downstream sees, because it is what the column holds.
    //
    // Defined this way rather than as a list of rejected types on purpose.
    // Checking the parser's output for shapes JSON loses means finding one
    // more shape every time somebody writes a new parser — proxies, hidden
    // keys, shared references, prototypes — and each is a separate rule
    // arriving as a separate defect. Serialising first makes all of them
    // unreachable at once, and the cost is stated rather than hidden: an
    // adapter that expected a `Date` is handed a string.
    //
    // What is still REFUSED is the parser that DERIVES rather than reshapes.
    // `Buffer.from(key).toString("base64")` encodes on the way in and encodes
    // the encoding on the way out, so the adapter authenticates with a
    // doubly-encoded credential and the provider answers "bad key" about a key
    // the operator entered correctly. That is not a type JSON cannot carry; it
    // is a value that changes every time it is read, and no serialisation
    // makes it stable.
    const stored = parsed as Record<string, unknown>;

    // Serialised ONCE and parsed TWICE. `roundTripped` is what a reader gets
    // and is handed to the parser; `unchanged` is an independent copy that
    // nothing else touches, and it is what the comparison is made against.
    //
    // Two objects rather than one because a parser may normalise IN PLACE and
    // return its input, which is an ordinary thing to write. Comparing the
    // result against the object it just mutated compares a value with itself
    // and passes whatever the parser did -- so an in-place derivation would
    // have walked through the check this exists to be.
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(stored);
    } catch (error) {
      // A `bigint`, a cycle, or a `toJSON` that throws. Reported as the
      // provider-configuration fault it is, because the raw `TypeError` would
      // surface as a generic internal failure naming neither the provider nor
      // what to change.
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: `Email provider "${type}" parsed its configuration into a value that cannot be written as JSON, so it cannot be stored. Return only what JSON can carry from \`parseConfig\`.`,
        logContext: {
          reason: "email-provider-configuration-not-serialisable",
          type,
          detail: error instanceof Error ? error.message : String(error),
        },
      });
    }

    // `JSON.stringify` returns `undefined` rather than throwing when the root
    // has a `toJSON` that returns nothing, so the catch above never sees it and
    // `JSON.parse(undefined)` then throws a `SyntaxError` the caller reads as a
    // generic internal failure. Rejected here as the same fault, because it is
    // one: the value cannot be written to the column.
    if (serialized === undefined) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: `Email provider "${type}" parsed its configuration into a value that cannot be written as JSON, so it cannot be stored. Return only what JSON can carry from \`parseConfig\`.`,
        logContext: {
          reason: "email-provider-configuration-not-serialisable",
          type,
        },
      });
    }

    // Coercion and DESTRUCTION are not the same thing, and only the first one
    // was decided. A `Date` serialises to a string that still carries it; a
    // `Map` of headers serialises to `{}` and carries nothing, so storing it
    // stores none of what the operator entered and the adapter runs without
    // their settings. Refused here rather than in the fixed-point check below,
    // which cannot see it: both sides of that comparison are already past the
    // column, so an empty projection agrees with an empty projection.
    //
    // Asked of the SERIALISATION rather than of the type. Anything that keeps
    // some of itself -- a string, a number, a populated object -- is a
    // coercion and is stored. Anything that keeps none of itself is refused,
    // whatever it was.
    const emptied = this.emptiedBySerialisation(stored);
    if (emptied) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: `Email provider "${type}" parsed its configuration into a value at ${emptied} that keeps nothing when written as JSON, so saving it would discard what was entered. Return a plain object or an array there.`,
        logContext: {
          reason: "email-provider-configuration-emptied-by-serialisation",
          type,
          path: emptied,
        },
      });
    }

    const roundTripped: unknown = JSON.parse(serialized);
    const unchanged: unknown = JSON.parse(serialized);

    // Checked again after the round trip, not only before it. A `toJSON` -- on
    // the object itself or on a `Date` inside it -- can turn a record into a
    // scalar or a list, and the first guard read the value the parser returned
    // rather than the value the column will hold. A passthrough parser then
    // makes the two sides agree, so the fixed-point check accepts it and every
    // later reader gets something it assumes is an object of fields.
    if (
      typeof roundTripped !== "object" ||
      roundTripped === null ||
      Array.isArray(roundTripped)
    ) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: `Email provider "${type}" parsed its configuration into a value that becomes a ${Array.isArray(roundTripped) ? "list" : typeof roundTripped} once written as JSON, and a configuration must be an object of fields. Return the parsed object from \`parseConfig\`.`,
        logContext: {
          reason: "email-provider-stored-form-not-object",
          type,
        },
      });
    }

    // The stored configuration IS its serialisation, so the comparison is made
    // in that domain rather than against the object the parser returned.
    //
    // A type JSON cannot carry is COERCED, not refused: a `Date` is written as
    // its ISO string, and a parser that reads that string back into a `Date`
    // agrees with the column even though the two values are not deep-equal.
    // The cost is real and is taken deliberately -- an adapter is handed the
    // string -- and the alternative is a surface that refuses a new shape every
    // time one is found. Anything the column cannot hold at all is still
    // refused above, where serialisation fails or produces a non-object.
    //
    // What survives is the property this check exists for: re-parsing the
    // stored form must MEAN the stored form. A parser that derives -- base64
    // on the way in, base64 of the base64 on the way out -- still differs
    // after its own round trip, and is still refused.
    let reparsedJson: unknown;
    try {
      const reparsed = provider.parseConfiguration(roundTripped);
      // Compared through a round trip rather than as a string. Two objects
      // holding the same fields in a different insertion order serialise to
      // different text, and a parser that rebuilds its output field by field
      // is an ordinary thing to write.
      const reserialized = JSON.stringify(reparsed);
      reparsedJson =
        reserialized === undefined ? undefined : JSON.parse(reserialized);
    } catch {
      // A parser that REJECTS its own stored output fails the same property,
      // and reaches it by throwing rather than by returning something else.
      // A re-parse that cannot itself be serialised lands here too, and means
      // the same thing: the row could not be read back.
      reparsedJson = undefined;
    }
    if (!isDeepStrictEqual(reparsedJson, unchanged)) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: `Email provider "${type}" cannot store this configuration, because parsing what would be saved does not return what was saved. Its \`parseConfig\` must accept its own output unchanged -- derive values in \`createAdapter\` instead.`,
        logContext: { reason: "email-provider-parse-not-a-fixed-point", type },
      });
    }

    // The VALIDATED form, not the object it was derived from. `encryptConfiguration`
    // serialises again, and returning the original would mean the value written
    // to the column is the product of a second serialisation that nothing
    // checked -- so a stateful getter or `toJSON` could store something that
    // never passed the checks above. Returning what was validated makes "what
    // is stored is what was checked" true by construction rather than by
    // argument, and the two are now the same object.
    return roundTripped as Record<string, unknown>;
  }

  /**
   * Where in a parsed configuration serialisation keeps NONE of a value, or
   * `undefined` when every value survives in some form.
   *
   * Asked of the projection rather than of the type, so a shape nobody has
   * thought of is judged by what it leaves behind rather than by whether it is
   * on a list. A `Date` becomes a string and keeps its instant; a `Map` or a
   * `Set` becomes `{}` and keeps nothing, because its entries are not own
   * enumerable properties and `JSON.stringify` reads nothing else.
   *
   * Only NON-ORDINARY objects are asked. A plain `{}` also projects to `{}`
   * and has lost nothing -- it was empty -- and the same is true of an object
   * whose only keys held `undefined`, which is how an absent optional field is
   * ordinarily written.
   *
   * @param value - a node of the parsed configuration
   * @param path - the keys walked to reach it, for the message
   */
  private emptiedBySerialisation(
    value: unknown,
    path: string[] = []
  ): string | undefined {
    if (value === null || typeof value !== "object") return undefined;

    const label = path.length === 0 ? "the configuration" : path.join(".");

    if (Array.isArray(value)) {
      for (const [index, entry] of value.entries()) {
        const emptied = this.emptiedBySerialisation(entry, [
          ...path,
          `[${index}]`,
        ]);
        if (emptied) return emptied;
      }
      return undefined;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      // Its own serialisation decides this, which is the point: a class that
      // defines `toJSON` and returns something useful is a coercion, and one
      // that defines nothing reachable is a loss. `undefined` here means the
      // key is dropped from its parent entirely, which the caller's own
      // guards already cover for the root and which is the ordinary meaning
      // of an absent optional anywhere else.
      const projection: string | undefined = JSON.stringify(value);
      if (projection !== undefined) {
        const asJson: unknown = JSON.parse(projection);
        if (
          asJson !== null &&
          typeof asJson === "object" &&
          !Array.isArray(asJson) &&
          Object.keys(asJson).length === 0
        ) {
          return label;
        }
      }
    }

    for (const [key, entry] of Object.entries(value)) {
      const emptied = this.emptiedBySerialisation(entry, [...path, key]);
      if (emptied) return emptied;
    }
    return undefined;
  }

  /**
   * A configuration reduced to its OWN enumerable fields.
   *
   * `JSON.stringify` reads own enumerable properties only, so the round trip
   * is what strips an inherited one -- and doing it BEFORE the parser runs is
   * what stops a schema from reading the prototype and reporting success.
   *
   * A value that cannot be written is reported as the provider-configuration
   * fault it is, rather than reaching the parser and failing later as
   * something less specific.
   */
  private ownFieldsOf(type: string, input: unknown): unknown {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(input);
    } catch (error) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: `Email provider "${type}" was sent a configuration that cannot be written as JSON, so it cannot be stored.`,
        logContext: {
          reason: "email-provider-input-not-serialisable",
          type,
          detail: error instanceof Error ? error.message : String(error),
        },
      });
    }
    // `undefined` for an absent configuration, which a parser may legitimately
    // accept -- handed through unchanged rather than turned into `null`.
    return serialized === undefined ? undefined : JSON.parse(serialized);
  }

  private encryptConfiguration(config: Record<string, unknown>): string {
    if (!this.encryptionSecret) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          "Email provider credentials cannot be saved because NEXTLY_SECRET is not set. " +
          "Set it in the environment and restart — provider passwords and API keys are " +
          "encrypted under it, and without it they would be stored readable.",
        logContext: { reason: "email-provider-no-encryption-key" },
      });
    }
    return encrypt(JSON.stringify(config), this.encryptionSecret);
  }

  /**
   * Decrypt a stored configuration value back to a JSON object.
   *
   * Deliberately more permissive than its write counterpart: it still accepts a
   * non-string stored value, which is what an install that wrote configuration
   * before the write path refused would have. Refusing to read those rows would
   * turn a credential stored in the clear into a provider nobody can open,
   * rotate, or delete — hiding exactly the records an operator needs to find.
   * The public read path masks them like any other, so tightening this would
   * cost recoverability and buy no confidentiality.
   */
  private decryptConfiguration(
    stored: Record<string, unknown> | string
  ): Record<string, unknown> {
    return this.readConfiguration(stored).config;
  }

  /**
   * Decrypt, and say whether it worked.
   *
   * `decryptConfiguration` answers `{}` for an unreadable value, which is the
   * right thing for a READ -- a provider whose ciphertext no longer decrypts
   * must still be listable, maskable and deletable rather than becoming a row
   * nobody can act on. It is the wrong thing for a COMPARISON: `{}` is also
   * what a genuinely empty configuration looks like, so a diff against an
   * unreadable preimage concludes nothing changed at the moment it is least
   * entitled to. Callers about to make a claim take this form and ask.
   */
  private readConfiguration(stored: Record<string, unknown> | string): {
    config: Record<string, unknown>;
    readable: boolean;
  } {
    if (!this.encryptionSecret || typeof stored !== "string") {
      return { config: stored as Record<string, unknown>, readable: true };
    }
    try {
      return {
        config: JSON.parse(decrypt(stored, this.encryptionSecret)),
        readable: true,
      };
    } catch {
      this.logger.warn(
        "Failed to decrypt provider configuration — returning empty object"
      );
      return { config: {}, readable: false };
    }
  }

  /**
   * The dotted paths a provider declared as secret, e.g. `auth.pass`.
   *
   * Returns null when the type is not registered — an uninstalled plugin
   * leaves rows behind, and those must still be readable and still masked.
   */
  private declaredSecretPaths(type: string): ReadonlySet<string> | null {
    const registry = getEmailProviderRegistry();
    if (!registry.has(type)) return null;

    const fields = registry.get(type).configFields;
    // No declared fields is not the same as declaring nothing secret. It is an
    // absence of information, and a provider can still store configuration
    // without describing it -- so treat it like a missing definition and mask
    // everything, rather than reading an empty list as permission.
    if (fields.length === 0) return null;

    return new Set(
      fields.filter(field => field.secret === true).map(field => field.name)
    );
  }

  /** Every path the provider describes, secret or not. */
  private declaredConfigPaths(type: string): ReadonlySet<string> {
    const registry = getEmailProviderRegistry();
    if (!registry.has(type)) return new Set();
    return new Set(registry.get(type).configFields.map(field => field.name));
  }

  /**
   * Mask a configuration object for a public read.
   *
   * Which values are secret is DECLARED by the provider, not guessed from key
   * names. The name heuristic below cannot know that `credential` holds one and
   * that a field merely containing `token` may not, and it can only ever be
   * right about names core has seen before — which is none of a plugin's.
   *
   * When no definition is available — the provider's package was uninstalled,
   * or it shipped no field metadata — EVERY leaf is masked rather than guessed
   * at. The key-name heuristic cannot reconstruct what the definition declared,
   * so a field the provider correctly marked secret (`credential`, say) would
   * come back in the clear precisely when the plugin that knew better is gone.
   * Absence of information has to mask more, not less; an over-masked read is
   * recoverable by reinstalling the package, a leaked credential is not.
   */
  /**
   * Whether a configuration path is one this read withholds.
   *
   * Three states, not two. `null` means no usable definition, so nothing is
   * known and everything is secret. Otherwise a path is public ONLY if the
   * provider declared it and did not mark it secret: a key the definition does
   * not mention at all -- a credential left behind by a plugin upgrade, say --
   * is unknown rather than public, and the parsers strip unknown keys for
   * adapter construction without removing them from storage.
   *
   * Asked by the mask AND by the strip that undoes it. Masking one set of
   * paths and unmasking a smaller one is not a mismatch that shows up as a
   * failure: a client echoing back what it was given writes the literal mask
   * over a real stored value, and the update reports success.
   */
  private pathIsSecret(
    path: string,
    secretPaths: ReadonlySet<string> | null,
    declaredPaths: ReadonlySet<string>
  ): boolean {
    if (secretPaths === null) return true;
    if (!declaredPaths.has(path)) return true;
    return secretPaths.has(path);
  }

  private maskConfiguration(
    config: Record<string, unknown>,
    secretPaths: ReadonlySet<string> | null,
    declaredPaths: ReadonlySet<string>,
    pathPrefix = ""
  ): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    for (const key of Object.keys(config)) {
      const value = config[key];
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;

      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        masked[key] = this.maskConfiguration(
          value as Record<string, unknown>,
          secretPaths,
          declaredPaths,
          path
        );
        continue;
      }

      masked[key] = this.pathIsSecret(path, secretPaths, declaredPaths)
        ? MASKED_VALUE
        : value;
    }
    return masked;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  /**
   * Drop the mask a client echoes back for a credential it did not touch.
   *
   * Restricted to paths the provider DECLARED secret. The value is the only
   * signal otherwise, and `••••••••` is a string a non-secret text field may
   * legitimately hold — dropping it there discards a real edit and reports
   * success, so the operator sees the old value survive a save they made.
   *
   * `secretPaths` is null when no definition is available (an uninstalled
   * plugin, or a provider that shipped no field metadata). Nothing is stripped
   * then: with no way to tell a credential from a value, keeping what the
   * caller sent is the choice that cannot silently lose an edit, and the
   * provider's own parser still decides whether the result is usable.
   */
  private stripMaskedConfigValues(
    config: Record<string, unknown>,
    secretPaths: ReadonlySet<string> | null,
    declaredPaths: ReadonlySet<string>,
    pathPrefix = ""
  ): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(config)) {
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;

      // Dropped for every path the READ would have masked, not only the
      // declared secrets. A path the read withholds comes back as the mask
      // whatever the reason, so keeping it here writes eight bullet characters
      // over whatever was really stored there.
      if (
        value === MASKED_VALUE &&
        this.pathIsSecret(path, secretPaths, declaredPaths)
      ) {
        continue;
      }

      if (this.isPlainObject(value)) {
        cleaned[key] = this.stripMaskedConfigValues(
          value,
          secretPaths,
          declaredPaths,
          path
        );
      } else {
        cleaned[key] = value;
      }
    }

    return cleaned;
  }

  private deepMergeConfig(
    base: Record<string, unknown>,
    incoming: Record<string, unknown>
  ): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(incoming)) {
      if (value === undefined) continue;

      // `null` is a VALUE here, carried through like any other. Removal is
      // asked for by `unsetConfiguration` instead, because a contributed
      // provider's `parseConfig` may accept a nullable field, and a create
      // already stores that null verbatim -- reading it as "delete" on the
      // patch path would make the same request mean two different things
      // depending on whether the row existed.
      if (this.isPlainObject(value) && this.isPlainObject(merged[key])) {
        merged[key] = this.deepMergeConfig(merged[key], value);
      } else {
        merged[key] = value;
      }
    }

    return merged;
  }

  /**
   * Narrow `unsetConfiguration` from what a request actually sent.
   *
   * The REST route copies this field out of parsed JSON, so the declared type
   * is a promise rather than a fact. A non-array reaching the walk below would
   * fail as a TypeError -- a 500 with a driver-shaped message for a malformed
   * request -- instead of the validation error the caller can act on.
   */
  private readUnsetPaths(value: unknown): readonly string[] {
    if (value === undefined) return [];
    // Indexed rather than `.some`, which SKIPS holes. A sparse array --
    // `new Array(1)` from a JavaScript Direct API caller -- therefore passed
    // this check while `for...of` below still visits the hole as `undefined`,
    // so `path.split(".")` threw a raw TypeError in place of the validation
    // response the caller can act on.
    const paths = Array.isArray(value) ? value : null;
    // A HOLE is not detectable with `some`, which skips them -- the same trait
    // that let a sparse array through in the first place. `Object.keys` on an
    // array lists only the indices that are PRESENT, so a length that does not
    // match is a hole.
    const hasHole =
      paths !== null && Object.keys(paths).length !== paths.length;
    const malformed =
      paths === null ||
      hasHole ||
      paths.some(entry => typeof entry !== "string");
    if (malformed) {
      throw NextlyError.validation({
        errors: [
          {
            path: "unsetConfiguration",
            code: "INVALID_TYPE",
            message: "Must be an array of configuration field names.",
          },
        ],
      });
    }
    return paths as string[];
  }

  /**
   * Remove the configuration paths an update asked to unset.
   *
   * Each path must name a field the provider DECLARES. That is the whole
   * safety argument: the strings are checked against a set built from the
   * registry, and `assertConfigFieldsAreUsable` already refuses a field named
   * `__proto__`, `constructor` or `prototype` at registration, so a request
   * cannot steer this walk anywhere a declared field does not go. An
   * undeclared path is rejected rather than ignored, because silently doing
   * nothing would leave the operator looking at a value they just cleared.
   *
   * Unsetting an absent path is not an error — it is the state being asked
   * for, and a retried request must not fail on its second attempt.
   */
  private applyConfigUnsets(
    config: Record<string, unknown>,
    paths: readonly string[],
    effectiveType: string
  ): Record<string, unknown> {
    if (paths.length === 0) return config;

    const declared = this.declaredConfigPaths(effectiveType);
    const undeclared = paths.filter(path => !declared.has(path));
    if (undeclared.length > 0) {
      throw NextlyError.validation({
        errors: undeclared.map(path => ({
          path: `unsetConfiguration.${path}`,
          code: "UNKNOWN_FIELD",
          message: `"${path}" is not a configuration field of this provider.`,
        })),
        logContext: { effectiveType, undeclared },
      });
    }

    const result = structuredClone(config);
    for (const path of paths) {
      const segments = path.split(".");
      const leaf = segments.pop();
      if (leaf === undefined) continue;

      // Every branch walked, so an emptied one can be removed on the way back
      // out.
      const branches: Array<{ parent: Record<string, unknown>; key: string }> =
        [];
      let branch: Record<string, unknown> = result;
      let reachable = true;
      for (const segment of segments) {
        const next = branch[segment];
        if (!this.isPlainObject(next)) {
          reachable = false;
          break;
        }
        branches.push({ parent: branch, key: segment });
        branch = next;
      }
      if (!reachable) continue;

      delete branch[leaf];

      // A branch left holding nothing is removed too. Clearing the last value
      // under `credentials` otherwise leaves `{ credentials: {} }`, and a
      // parser written as `credentials: z.object({...}).optional()` accepts an
      // absent object and rejects an empty one -- so the field could not be
      // cleared at all. Innermost first, because emptying one can empty its
      // own parent.
      //
      // A provider that needs the branch to survive says so with
      // `blankAs: "empty"` on its fields, which keeps them out of this list
      // entirely rather than relying on an empty object being preserved.
      for (let index = branches.length - 1; index >= 0; index -= 1) {
        const entry = branches[index];
        if (entry === undefined) break;
        const value = entry.parent[entry.key];
        if (!this.isPlainObject(value) || Object.keys(value).length > 0) break;
        delete entry.parent[entry.key];
      }
    }
    return result;
  }

  /**
   * Read a raw row from the database and return it with masked configuration.
   */
  private toMaskedRecord(row: RawEmailProviderRow): EmailProviderRecord {
    const config = this.decryptConfiguration(row.configuration);
    return {
      ...row,
      configuration: this.maskConfiguration(
        config,
        this.declaredSecretPaths(row.type),
        this.declaredConfigPaths(row.type)
      ),
    };
  }

  /**
   * Read a raw row from the database and return it with decrypted configuration.
   */
  private toDecryptedRecord(row: RawEmailProviderRow): EmailProviderRecord {
    return {
      ...row,
      configuration: this.decryptConfiguration(row.configuration),
    };
  }

  // ============================================================
  // CRUD Methods (public — return masked configuration)
  // ============================================================

  /**
   * Create a new email provider.
   *
   * Configuration is encrypted before storage.
   *
   * If `isDefault` is true, the demotion of the previous default and this
   * insert are one transaction, so the table never holds two defaults and
   * never holds none. It does not serialise two callers doing this at once.
   */
  async createProvider(
    data: CreateEmailProviderInput,
    /**
     * Who performed this, for the audit trail. Optional so an internal or
     * seeded write needs no ceremony; those produce no entry by design.
     */
    actor?: RequestActor | null
  ): Promise<EmailProviderRecord> {
    // Reject an unregistered type and an unusable configuration BEFORE the
    // insert. Without this a row stores happily and fails only when something
    // tries to send through it, inside a catch that reports `{ success: false }`
    // -- so the operator learns at the worst moment and with the least detail.
    // The PARSED configuration is what gets stored, so that the row and the
    // value the adapter runs on are the same thing. They were not: the service
    // stored whatever the caller sent while the adapter closed over the parse
    // result, and every difference between the two became a defect somewhere
    // that read the row.
    const parsedConfiguration = this.storableConfiguration(
      data.type,
      data.configuration
    );

    const id = randomUUID();
    const now = new Date();

    const values = {
      id,
      name: data.name,
      type: data.type,
      fromEmail: data.fromEmail,
      fromName: data.fromName ?? null,
      configuration: this.encryptConfiguration(parsedConfiguration),
      isDefault: data.isDefault ?? false,
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };

    let displaced: DisplacedDefault[] = [];
    try {
      // The demotion and the insert are one change to the table, so they
      // commit together or not at all. On separate connections a refused
      // insert -- a duplicate name, a lost connection -- took the working
      // default away and put nothing in its place; inside the transaction the
      // same failure rolls the demotion back with it.
      //
      // The demotion goes FIRST. Postgres carries a partial unique index over
      // `is_default = true`, checked per row as each statement runs, so a
      // second row inserted as the default while the incumbent still holds it
      // is rejected outright.
      if (values.isDefault) {
        await this.withTransaction(async txRaw => {
          const tx = txRaw as ProviderTransaction;
          displaced = await this.demoteOtherDefaults(tx, now, id);
          await tx.insert(this.emailProviders).values(values);
        });
      } else {
        // No handover, so nothing to make atomic WITH. Opening a transaction
        // anyway costs correctness on SQLite, where `withTransaction` issues
        // `BEGIN IMMEDIATE` on the one shared connection: a second write that
        // arrives while the first is between its BEGIN and COMMIT cannot
        // begin, and is refused outright. A single statement has no such
        // window.
        await this.db.insert(this.emailProviders).values(values);
      }
    } catch (error) {
      // Drizzle surfaces the driver's raw error here, so normalise it through
      // toDbError(dialect) first; otherwise NextlyError.fromDatabaseError would
      // see a non-DbError and fall back to the generic INTERNAL_ERROR shape.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    // Recorded after the insert commits and before the read, so a trail entry
    // cannot exist for a provider that was never stored.
    await this.recordActivity({
      action: "create",
      providerId: id,
      providerName: data.name,
      providerType: data.type,
      actor,
    });
    await this.recordDemotions(displaced, actor);

    return this.getProvider(id);
  }

  /**
   * Refuse to promote a provider nothing can build an adapter for.
   *
   * Promotion decides which provider carries every unrouted message, so
   * promoting a type whose plugin has been removed points all of them at
   * something that fails at send time -- AND clears the working default on the
   * way, so the damage outlives the request that caused it.
   *
   * Written once because two methods promote: `setDefault`, and
   * `updateProvider` with `isDefault: true`. The second reaches the same
   * statement through a catch-all PATCH or a Direct API update that names no
   * configuration at all, so a guard living in the first is a guard the second
   * does not have.
   *
   * Refused BEFORE anything is written, so a refusal leaves the stored default
   * exactly as it was and there is nothing to attribute in the trail.
   */
  private assertPromotable(id: string, type: string): void {
    if (getEmailProviderRegistry().has(type)) return;

    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage:
        "This provider's type is not registered on this server, so it cannot be made the default. Install the package that provides it first.",
      logContext: { id, type },
    });
  }

  /**
   * Take the default away from every provider except the one that now holds it.
   *
   * Runs BEFORE the write that promotes, inside the same transaction.
   * Postgres carries a partial unique index over `is_default = true` and
   * checks it as each statement runs, so a row cannot take the default while
   * the incumbent still holds it — the incumbent gives it up first, and the
   * transaction is what makes the gap between them invisible and undoable.
   *
   * Its caller checks that the promotion has a target before calling this. A
   * promoting write that matches nothing after the incumbent has been stripped
   * would leave the installation unable to send anything it was not given a
   * provider for, with nothing in the trail to say why.
   *
   * Returns the rows it demoted rather than recording them. An entry written
   * from in here would claim a demotion a rollback then took back, and the
   * trail's one job is to not say that.
   *
   * This settles the ORDER of a handover, not who wins a race for it. Two
   * concurrent promotions still both commit, on MySQL and SQLite as well as
   * Postgres, because nothing here locks the rows it read.
   */
  private async demoteOtherDefaults(
    tx: ProviderTransaction,
    now: Date,
    promotedId: string
  ): Promise<DisplacedDefault[]> {
    const others = and(
      eq(this.emailProviders.isDefault, true),
      ne(this.emailProviders.id, promotedId)
    );

    const displaced = await tx
      .select({
        id: this.emailProviders.id,
        name: this.emailProviders.name,
        type: this.emailProviders.type,
      })
      .from(this.emailProviders)
      .where(others);

    if (displaced.length === 0) return displaced;

    await tx
      .update(this.emailProviders)
      .set({ isDefault: false, updatedAt: now })
      .where(others);

    return displaced;
  }

  /**
   * Write the trail entries for a handover, once it has committed.
   *
   * Separate from the statement that demoted them for the reason the entries
   * are worth having: a durable claim that a provider stopped being the
   * default has to outlive only the transactions that actually did it.
   */
  private async recordDemotions(
    displaced: DisplacedDefault[],
    actor?: RequestActor | null
  ): Promise<void> {
    for (const previous of displaced) {
      await this.recordActivity({
        action: "update",
        providerId: previous.id,
        providerName: previous.name,
        providerType: previous.type,
        changedFields: ["isDefault"],
        actor,
      });
    }
  }

  /**
   * Record a provider mutation, and never let recording break the mutation.
   *
   * The write has already committed by the time this runs. `recordProviderActivity`
   * failing is not a reason to report the write as failed, so the failure is
   * turned into a log line instead -- a trail that quietly stops being written
   * should be visible somewhere.
   */
  private async recordActivity(
    input: EmailProviderActivityInput
  ): Promise<void> {
    try {
      await recordProviderActivity(input);
    } catch (error) {
      try {
        this.logger.error("Failed to record email provider activity", {
          providerId: input.providerId,
          action: input.action,
          message: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Nowhere left to report to: the reporting mechanism is what failed.
        // The mutation this describes has already committed, so letting the
        // throw out would report a create, an update, a delete or a promotion
        // as failed after it happened -- and invite a retry of something that
        // does not need one.
      }
    }
  }

  /**
   * Get a single email provider by ID.
   * Returns masked configuration — use `getProviderDecrypted()` for internal access.
   *
   * @throws NextlyError NOT_FOUND if provider doesn't exist
   */
  async getProvider(id: string): Promise<EmailProviderRecord> {
    const row = await this.getRawProvider(id);
    return this.toMaskedRecord(row);
  }

  /**
   * List all email providers, ordered by creation date (newest first).
   * Returns masked configuration for all providers.
   */
  async listProviders(): Promise<EmailProviderRecord[]> {
    const results = await this.db
      .select()
      .from(this.emailProviders)
      .orderBy(desc(this.emailProviders.createdAt));

    return (results as RawEmailProviderRow[]).map(row =>
      this.toMaskedRecord(row)
    );
  }

  /**
   * Update an existing email provider.
   * Configuration is encrypted before storage.
   *
   * Provider `type` may be changed. The stored configuration is
   * re-validated against the new provider, since the rules that accepted it
   * belonged to the old one.
   *
   * @throws NextlyError NOT_FOUND if provider doesn't exist
   */
  async updateProvider(
    id: string,
    data: UpdateEmailProviderInput,
    actor?: RequestActor | null
  ): Promise<EmailProviderRecord> {
    const currentRow = await this.getRawProvider(id);

    const now = new Date();
    // Whether the merged configuration differs from the stored one, decided
    // before encryption where the two are comparable.
    let configurationChanged = false;
    const updateData: Record<string, unknown> = {
      updatedAt: now,
    };

    // The type this row will have once the update lands. A type change with no
    // configuration alongside it still has to name a registered provider,
    // otherwise the row survives as one nothing can build an adapter for.
    const effectiveType = data.type ?? currentRow.type;
    const typeChanged =
      data.type !== undefined && data.type !== currentRow.type;
    if (typeChanged) {
      // A type change REPLACES the provider-specific configuration rather than
      // merging it: the two providers have different shapes, and an SMTP host
      // carried into a Resend config is not a partial edit, it is leftover.
      // Validating the OLD configuration here would fail every real switch,
      // because the submitted API key is exactly what the old shape lacks.
      const submitted =
        data.configuration !== undefined
          ? this.stripMaskedConfigValues(
              data.configuration,
              this.declaredSecretPaths(data.type as string),
              this.declaredConfigPaths(data.type as string)
            )
          : {};
      const parsedSubmitted = this.storableConfiguration(
        data.type as string,
        submitted
      );

      // Persist the replacement even when the update carried no configuration.
      // Validating `{}` and then not writing it leaves the PREVIOUS provider's
      // encrypted configuration under the new type -- so a permissive target
      // parser would receive stale credentials, which is exactly what
      // "a type change replaces rather than merges" is supposed to prevent.
      if (data.configuration === undefined) {
        updateData.configuration = this.encryptConfiguration(parsedSubmitted);
        // This branch REPLACES the stored configuration without the caller
        // having sent one, so the diff below -- which only runs when
        // `data.configuration` is present -- would have reported a type change
        // and nothing else. An entry that says "type" while the credentials
        // beneath it were discarded is worse than no entry: it is a record
        // that reads as harmless.
        //
        // An UNREADABLE preimage counts as a change on its own. `{}` is what
        // this returns both for an empty configuration and for a ciphertext
        // that no longer decrypts -- after a `NEXTLY_SECRET` rotation, say --
        // and the second is precisely when a credential is being discarded.
        // Reading the fallback as "there was nothing there" would file the
        // loss as a type change and nothing more.
        const previous = this.readConfiguration(currentRow.configuration);
        configurationChanged =
          !previous.readable || Object.keys(previous.config).length > 0;
      }
    }

    if (data.name !== undefined) updateData.name = data.name;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.fromEmail !== undefined) updateData.fromEmail = data.fromEmail;
    if (data.fromName !== undefined) updateData.fromName = data.fromName;
    // An update that only clears fields carries no `configuration` of its own,
    // so the branch below has to run for either half of the request. Without
    // this, unsetting a value while changing nothing else would be accepted
    // and do nothing.
    const unsetPaths = this.readUnsetPaths(data.unsetConfiguration);
    if (data.configuration !== undefined || unsetPaths.length > 0) {
      // Read through `readConfiguration`, not `decryptConfiguration`: the diff
      // below has to tell an empty stored configuration from one that no
      // longer decrypts, and both arrive as `{}`.
      const existing = this.readConfiguration(currentRow.configuration);
      const existingConfig = existing.config;
      const incomingConfig = this.stripMaskedConfigValues(
        data.configuration ?? {},
        this.declaredSecretPaths(effectiveType),
        this.declaredConfigPaths(effectiveType)
      );
      // Across a type change the stored configuration belongs to the previous
      // provider, so it is discarded rather than merged into the new shape.
      const mergedConfig = this.applyConfigUnsets(
        typeChanged
          ? incomingConfig
          : this.deepMergeConfig(existingConfig, incomingConfig),
        unsetPaths,
        effectiveType
      );

      // Validate the MERGED result, not the incoming patch: an update usually
      // carries only the fields that changed, and the masked values it omits
      // are supplied by the merge. Checking the patch alone would reject every
      // partial edit for missing required fields it was never meant to send.
      //
      // Validated against the type this update RESULTS IN, not the stored one.
      // `data.type` is applied a few lines above, so a change from smtp to
      // resend would otherwise have its configuration checked by the SMTP
      // parser and stored under resend -- accepted here and unusable at send.
      const parsedMerged = this.storableConfiguration(
        effectiveType,
        mergedConfig
      );

      // Compared BEFORE encryption. Encryption is randomised -- a fresh salt
      // and IV per call -- so two encryptions of identical configuration never
      // match, and comparing ciphertexts reported a credential change on every
      // save the form made, including one that touched nothing but the name.
      // A false credential-change alert is worse in an audit trail than no
      // entry: it is noise on the one signal the trail exists for.
      //
      // Nothing is decrypted for this. Both values are already in memory --
      // `existingConfig` two statements above and `mergedConfig` beside it --
      // because the update path had to read one and build the other.
      //
      // An unreadable preimage is a change by itself, for the reason given in
      // the type-change branch: comparing against the `{}` fallback would
      // report "unchanged" for a save that replaced a credential nobody could
      // read with one they can.
      // Compared on the PARSED form, which is what is now stored. Comparing
      // the merged input against a stored parsed value reported a change on
      // every save whose parser normalises anything — a trimmed credential
      // differs from its own stored form on the way in, and never after.
      configurationChanged =
        !existing.readable ||
        JSON.stringify(existingConfig) !== JSON.stringify(parsedMerged);

      updateData.configuration = this.encryptConfiguration(parsedMerged);
    }
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

    // Before the write, and before the demotion inside it: a refused promotion
    // must leave the existing default alone.
    if (data.isDefault === true) {
      this.assertPromotable(id, effectiveType);
    }

    let updatedRows = 0;
    let displaced: DisplacedDefault[] = [];
    try {
      // One transaction, with the demotion before the write that promotes.
      // Postgres rejects a second row holding `is_default = true` as the
      // statement runs, so the incumbent has to give it up first -- and the
      // transaction is what makes that safe, since a failure anywhere after it
      // rolls the demotion back.
      if (data.isDefault === true) {
        await this.withTransaction(async txRaw => {
          const tx = txRaw as ProviderTransaction;
          displaced = await this.demoteOtherDefaults(tx, now, id);

          const result = await tx
            .update(this.emailProviders)
            .set(updateData)
            .where(eq(this.emailProviders.id, id));
          updatedRows = affectedRowCount(result, this.dialect);

          // The row can be deleted between the read this update was built
          // from and this statement. The demotion has already run, so
          // committing here would leave the installation with no default at
          // all -- throwing takes the demotion back with it, and the caller is
          // told the truth, which is that the provider is gone.
          if (updatedRows === 0) {
            throw NextlyError.notFound({ logContext: { id } });
          }
        });
      } else {
        // No handover, so nothing to make atomic WITH -- and a transaction
        // here costs correctness on SQLite, where `withTransaction` issues
        // `BEGIN IMMEDIATE` on the one shared connection and a second write
        // arriving mid-window cannot begin at all.
        const result = await this.db
          .update(this.emailProviders)
          .set(updateData)
          .where(eq(this.emailProviders.id, id));
        updatedRows = affectedRowCount(result, this.dialect);
      }
    } catch (error) {
      // A `NextlyError` from inside the transaction was thrown deliberately --
      // the handover raises one to roll its own demotion back -- so it carries
      // a decision about what this failure IS. Normalising it as a driver
      // error would relabel a chosen NOT_FOUND as an internal one and tell the
      // caller nothing they can act on.
      if (NextlyError.is(error)) throw error;

      // DbError → NextlyError; spec §13.8 keeps the public message generic and
      // tucks the dialect-specific code into logContext via fromDatabaseError.
      // Normalise raw driver errors via toDbError(dialect) first so the kind
      // is preserved (otherwise PG 23505 collapses to INTERNAL_ERROR).
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    // A delete can land between the read above and this statement, and the
    // update then matches nothing. Recording the requested fields anyway would
    // leave a durable entry claiming a change to a row that no longer exists,
    // moments before `getProvider` reports it absent. Every dialect counts
    // MATCHED rows here, not modified ones, so a request that genuinely
    // rewrites nothing still reaches the trail.
    if (updatedRows === 0) return this.getProvider(id);

    await this.recordDemotions(displaced, actor);

    // Field NAMES only, and `configuration` counted as one name rather than by
    // its inner paths: naming `auth.pass` in a widely-readable row says which
    // credential changed, which is a detail about the secret in a place the
    // secret is not supposed to reach.
    await this.recordActivity({
      action: "update",
      providerId: id,
      providerName: data.name ?? currentRow.name,
      providerType: effectiveType,
      changedFields: [
        // Built from the fields this service RECOGNISES, never by spreading
        // the request body. `data` is a cast over parsed JSON, so an unknown
        // key -- `{"notAProviderField": true}` -- is ignored by every write
        // above and would otherwise be reported as a changed field, putting a
        // request-controlled string into a widely readable audit row and
        // claiming a change that never happened.
        ...changedProviderFields(
          {
            name: currentRow.name,
            type: currentRow.type,
            fromEmail: currentRow.fromEmail,
            fromName: currentRow.fromName,
            isDefault: currentRow.isDefault,
            isActive: currentRow.isActive,
          },
          {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.type !== undefined ? { type: data.type } : {}),
            ...(data.fromEmail !== undefined
              ? { fromEmail: data.fromEmail }
              : {}),
            ...(data.fromName !== undefined ? { fromName: data.fromName } : {}),
            ...(data.isDefault !== undefined
              ? { isDefault: data.isDefault }
              : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          }
        ),
        ...(configurationChanged ? ["configuration"] : []),
      ],
      actor,
    });

    return this.getProvider(id);
  }

  /**
   * Delete an email provider.
   *
   * Cannot delete the default provider — set another provider
   * as default first.
   * Idempotent — returns successfully if provider doesn't exist.
   *
   * @throws NextlyError BUSINESS_RULE_VIOLATION if provider is the default
   */
  async deleteProvider(id: string, actor?: RequestActor | null): Promise<void> {
    let row;
    try {
      row = await this.getRawProvider(id);
    } catch (error) {
      // If provider doesn't exist, consider it already deleted (idempotent).
      // Use the structural NextlyError.isCode guard so this still works when
      // the thrown error came through `withDbErrors` or any cross-boundary path.
      if (NextlyError.isCode(error, "NOT_FOUND")) {
        this.logger.info(
          `Provider ${id} not found during delete — already deleted`,
          { id }
        );
        return;
      }
      throw error;
    }

    if (row.isDefault) {
      // Identifier (`id`) belongs in logContext per spec §13.8; the public
      // sentence stays generic and free of identifiers.
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          "Cannot delete the default email provider. Set another provider as default first.",
        logContext: { id },
      });
    }

    const result = await this.db
      .delete(this.emailProviders)
      .where(eq(this.emailProviders.id, id));

    // Two deletes of the same provider can both read the row before either
    // statement runs; the second affects nothing and must not attribute a
    // deletion to whoever sent it. The method stays idempotent -- both callers
    // still succeed -- but only the one that actually removed the row is
    // recorded as having done so.
    if (affectedRowCount(result, this.dialect) === 0) return;

    // Recorded from the row read before the delete, because after it there is
    // nothing left to name. A deleted provider's entry is the one whose
    // subject the reader can no longer recover any other way.
    await this.recordActivity({
      action: "delete",
      providerId: id,
      providerName: row.name,
      providerType: row.type,
      actor,
    });
  }

  /**
   * Set a provider as the default.
   *
   * The demotion of the previous default and this promotion are one
   * transaction, and the target is checked before either, so a promotion that
   * matches nothing cannot leave the installation with no default at all. It
   * does not serialise two callers promoting different providers at once.
   *
   * @throws NextlyError NOT_FOUND if provider doesn't exist
   */
  async setDefault(
    id: string,
    actor?: RequestActor | null
  ): Promise<EmailProviderRecord> {
    const row = await this.getRawProvider(id);

    // A provider whose type is no longer registered cannot build an adapter,
    // so promoting it points every unrouted message at something that fails at
    // send time -- and the promotion clears the working default on its way, so
    // the damage outlives the request that caused it.
    //
    // Refused BEFORE the audit entry below, because there is nothing to
    // attribute: this leaves the stored default exactly as it was.
    //
    // Enforced here rather than only in the admin: the REST route and the
    // Direct API reach this method without passing the list page, and a rule
    // that lives in one caller is a rule the others do not have.
    this.assertPromotable(row.id, row.type);

    const now = new Date();

    // Demote, then promote, both inside one transaction. Postgres refuses a
    // second row holding the default as the statement runs, so the order is
    // forced -- and the transaction is what keeps it safe, because a failure
    // after the demotion takes the demotion back with it.
    //
    // The provider can be deleted between the read above and this block. A
    // check before the demotion cannot close that: nothing here locks the row,
    // so a delete committed by another transaction lands between the check and
    // the statement on Postgres and MySQL alike. The promotion's own row count
    // is what actually knows, and it is only known afterwards -- so the
    // decision is made there, and throwing is what takes the demotion back.
    let displaced: DisplacedDefault[] = [];
    await this.withTransaction(async txRaw => {
      const tx = txRaw as ProviderTransaction;
      displaced = await this.demoteOtherDefaults(tx, now, id);

      const promotion = await tx
        .update(this.emailProviders)
        .set({ isDefault: true, updatedAt: now })
        .where(eq(this.emailProviders.id, id));

      if (affectedRowCount(promotion, this.dialect) === 0) {
        // Rolls the demotion back with it. Committing instead would leave the
        // installation with no default at all and answer the caller with a
        // provider that no longer exists, which is two wrong things rather
        // than the one true one.
        throw NextlyError.notFound({ logContext: { id } });
      }
    });

    await this.recordDemotions(displaced, actor);

    // An `update` touching `isDefault`, because that is what it is. Promotion
    // decides which provider sends every unrouted message, so it is the change
    // most worth attributing and the least visible in the record it otherwise
    // leaves -- one boolean, on two rows.
    await this.recordActivity({
      action: "update",
      providerId: id,
      providerName: row.name,
      providerType: row.type,
      // A client retry promotes a provider that is already the default. The
      // final state is identical, so claiming `isDefault` changed manufactures
      // an audit event out of a no-op. An empty list is what the recorder
      // reads as "nothing moved", and it writes no row at all for one -- the
      // same answer the update path beside this one gets.
      changedFields: row.isDefault ? [] : ["isDefault"],
      actor,
    });

    return this.getProvider(id);
  }

  /**
   * Get the default email provider with masked configuration.
   *
   * Returns `null` if no default is configured.
   */
  async getDefaultProvider(): Promise<EmailProviderRecord | null> {
    const results = await this.db
      .select()
      .from(this.emailProviders)
      .where(eq(this.emailProviders.isDefault, true))
      .limit(1);

    if (!results[0]) return null;
    return this.toMaskedRecord(results[0]);
  }

  /**
   * Test an email provider by sending a test email.
   *
   * Validates that the provider exists and is active, then creates a
   * temporary adapter from the provider's decrypted configuration and
   * sends a test email directly (avoids circular dependency with EmailService).
   */
  async testProvider(
    id: string,
    testEmail?: string,
    /**
     * `"send"` dispatches a real message, which is what the REST route and the
     * admin's Send Test button promise. `"connection"` asks the provider's own
     * probe instead and sends nothing — available only where the descriptor
     * reports `capabilities.connectionTest`. Defaulted so every existing caller
     * keeps the contract it was written against.
     */
    mode: "send" | "connection" | undefined = "send"
  ): Promise<{ success: boolean; error?: string }> {
    const provider = await this.getProviderDecrypted(id);

    if (!provider.isActive) {
      return {
        success: false,
        error: "Provider is inactive. Activate it before testing.",
      };
    }

    // An unrecognised mode is refused rather than treated as the default.
    // This argument decides whether a real message leaves the building, and a
    // TypeScript union does not constrain a JavaScript caller or a wrapper that
    // forwards a request body: a misspelled `"connecton"` would otherwise fall
    // through and send mail the caller was explicitly trying not to send.
    if (mode !== "send" && mode !== "connection") {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: `Unknown email provider test mode. Use "send" to dispatch a message or "connection" to probe without sending.`,
        logContext: { providerId: id, mode: String(mode) },
      });
    }

    // Whether a message was actually handed to the provider. The catch below
    // is shared with the connection probe AND with everything that happens
    // before dispatch -- building the adapter can throw on its own, when a
    // plugin has been removed or stored configuration no longer constructs
    // one. A delivery recorded for either is a phantom send: a row in the
    // history for a message that was never composed.
    let dispatched = false;

    // Resolved ONCE, outside the try, because both the resolved path and the
    // catch record a delivery for this destination and they have to record the
    // same one. Every reader hashes the bare address, so a row stored under
    // the hash of `Jane <jane@example.com>` could never be found again --
    // which is why the normalisation has to be shared rather than repeated.
    const testMailbox = mailboxOf(testEmail || provider.fromEmail);

    try {
      // Only when the caller explicitly asked to probe. Substituting a probe
      // for the send would have been silent and wrong: `api/email-providers-test.ts`
      // reports a dispatched message and the admin tells the operator to check
      // that inbox, so an SMTP user would have seen success with nothing sent.
      if (mode === "connection") {
        const registry = getEmailProviderRegistry();
        const probe = registry.has(provider.type)
          ? registry.get(provider.type).testConnectionFrom
          : undefined;
        if (!probe) {
          return {
            success: false,
            error: "This provider cannot be tested without sending a message.",
          };
        }
        const result = await probe(provider.configuration);
        if (result.ok) return { success: true };

        // The probe's own `detail` is NOT returned. It is written by the
        // provider, which received decrypted configuration, so a message like
        // `Invalid key ${config.apiKey}` would hand a credential to anyone who
        // pressed Test — the same disclosure the thrown path normalises, and
        // returning rather than throwing must not be the way around it.
        // Operators keep the detail: it goes to the server log.
        this.logger.warn("Email provider connection test failed", {
          providerId: id,
          providerType: provider.type,
          detail: result.detail,
        });
        return {
          success: false,
          error:
            "Connection test failed. The provider's reason is in the server log.",
        };
      }

      const adapter = this.createAdapterFromProvider(provider);
      const from = provider.fromName
        ? `${provider.fromName} <${provider.fromEmail}>`
        : provider.fromEmail;

      // Fall back to the provider's own fromEmail when no test address is
      // given. Dispatched in the form the caller wrote it, which may carry a
      // display name; `testMailbox` is what is RECORDED and compared.
      const to = testEmail || provider.fromEmail;

      dispatched = true;
      // Named rather than inlined, so the containment below checks the text
      // that was actually dispatched rather than a second copy of it.
      const subject = "Nextly — Test Email";
      const html = `<p>This is a test email from your <strong>${provider.name}</strong> email provider.</p><p>If you received this, your provider is configured correctly.</p>`;

      const result = await adapter.send({ to, from, subject, html });

      // A test has exactly one destination, so a provider that accepted the
      // message and refused THAT address delivered nothing -- the same reading
      // the ordinary send path applies to its primary recipient. Reporting the
      // message-level result would let the Test button say a provider works
      // when the one address it tried was rejected.
      //
      // Compared as MAILBOXES. A caller may write `Jane <jane@example.com>`,
      // and SMTP reports its refusal as the bare address -- so comparing the
      // strings as written never matches, and the Test button reports success
      // for the one recipient the provider refused.
      const accepted = !refusedMailboxes(result.rejected).has(
        testMailbox.toLowerCase()
      );
      const delivered = result.success && accepted;

      // The whole result, not a boolean. A failed test whose row carries no
      // reason is a row that says only "something went wrong", and a
      // successful one without the provider's message id cannot be matched
      // against the provider's own record of it.
      await this.recordTestDelivery(testMailbox, provider, {
        status: delivered ? "sent" : "failed",
        // The same two questions the ordinary send path asks, in the same
        // order: a shape core recognises, then none of this message's
        // recipients. A provider may build its identifier out of the address
        // it was handed, and the test destination is a recipient like any
        // other -- storing it verbatim would put the address beside the hash
        // that exists to avoid holding it.
        messageId: isRecognisedMessageId(result.messageId)
          ? messageIdWithoutRecipients(result.messageId, [testMailbox])
          : null,
        error: delivered
          ? null
          : accepted
            ? SEND_RETURNED_UNSUCCESSFUL
            : TEST_RECIPIENT_REFUSED,
      });

      return {
        success: delivered,
        error: delivered
          ? undefined
          : accepted
            ? SEND_RETURNED_UNSUCCESSFUL
            : TEST_RECIPIENT_REFUSED,
      };
    } catch (error) {
      // Only a send that actually reached the provider. `mode === "send"` is
      // not enough on its own: the adapter is built inside this try, so a
      // removed plugin or unusable stored configuration lands here having
      // dispatched nothing.
      //
      // A NextlyError's publicMessage is a decision about what may be shown.
      // Anything else is a message the throw site happened to interpolate, and
      // a contributed adapter throws with decrypted configuration in scope.
      if (dispatched) {
        await this.recordTestDelivery(testMailbox, provider, {
          status: "failed",
          messageId: null,
          // The NORMALISED message. `cause` is the provider's own error,
          // thrown with decrypted configuration in scope, and storing it would
          // put a credential in a database column.
          error: describeProviderFailure(error).message,
        });
      }

      // Logged HERE, with the cause. Attaching an original error to a
      // NextlyError does not record it anywhere: this catch converts the error
      // into a result and the request ends, so a provider's actual diagnostic
      // was retained and then dropped — while the message told the operator to
      // go and read it. A promise about a log entry has to be made true by
      // something writing one.
      // Wrapped, and AFTER the record above. An install's logger throwing
      // from `error()` would otherwise leave the catch before the delivery row
      // is written, so a real send that reached the provider and failed would
      // leave no trace of having happened at all.
      try {
        this.logger.error("Email provider test failed", {
          providerId: id,
          providerType: provider.type,
          mode,
          // Shared with the ordinary send path so the two cannot come to
          // disagree about how far down a `cause` chain to look.
          ...describeProviderFailure(error),
        });
      } catch {
        // Nowhere left to report to: the reporting mechanism is what failed.
      }

      return {
        success: false,
        error: NextlyError.is(error)
          ? error.publicMessage
          : "The test failed. The reason is in the server log.",
      };
    }
  }

  /**
   * Record a test send, and never let recording change its outcome.
   *
   * The message has already gone out (or already failed) by the time this
   * runs, so a recording failure must not turn a delivered test into a
   * reported failure. `record` swallows its own errors; this wrapper exists so
   * the call site reads as one thing.
   */
  private async recordTestDelivery(
    to: string,
    provider: EmailProviderRecord,
    outcome: Pick<EmailDeliveryInput, "status" | "messageId" | "error">
  ): Promise<void> {
    await this.deliveries?.record({
      to,
      providerId: provider.id,
      providerType: provider.type,
      // A test carries no template. Recording one would name a message the
      // operator never chose to send.
      templateSlug: null,
      ...outcome,
    });
  }

  /**
   * Create a provider adapter from a decrypted provider record.
   */
  private createAdapterFromProvider(
    provider: EmailProviderRecord
  ): EmailProviderAdapter {
    const config = provider.configuration;

    // Built-ins (smtp/resend/sendlayer) + any plugin-contributed provider types
    // (C2/D65). Unknown type → BUSINESS_RULE_VIOLATION (raised by the registry).
    return getEmailProviderRegistry().create(provider.type, config);
  }

  // ============================================================
  // Internal Methods (decrypted — for email adapters only)
  // ============================================================

  /**
   * Get a single email provider with decrypted configuration.
   * **Internal use only** — for email sending adapters that need real credentials.
   *
   * @throws NextlyError NOT_FOUND if provider doesn't exist
   */
  async getProviderDecrypted(id: string): Promise<EmailProviderRecord> {
    const row = await this.getRawProvider(id);
    return this.toDecryptedRecord(row);
  }

  /**
   * Get the default email provider with decrypted configuration.
   * **Internal use only** — for email sending adapters that need real credentials.
   *
   * Returns `null` if no default is configured.
   */
  async getDefaultProviderDecrypted(): Promise<EmailProviderRecord | null> {
    const results = await this.db
      .select()
      .from(this.emailProviders)
      .where(eq(this.emailProviders.isDefault, true))
      .limit(1);

    if (!results[0]) return null;
    return this.toDecryptedRecord(results[0]);
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Fetch a raw provider row from the database (no decryption or masking).
   *
   * @throws NextlyError NOT_FOUND if provider doesn't exist
   */
  private async getRawProvider(id: string): Promise<RawEmailProviderRow> {
    const results = await this.db
      .select()
      .from(this.emailProviders)
      .where(eq(this.emailProviders.id, id))
      .limit(1);

    if (results.length === 0) {
      // Identifier `id` is for operators only — not echoed to the public message
      // per spec §13.8. The 404 factory uses the canonical "Not found." sentence.
      throw NextlyError.notFound({ logContext: { id } });
    }

    return results[0];
  }
}
