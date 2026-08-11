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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { eq, desc } from "drizzle-orm";

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
  changedProviderFields,
  recordProviderActivity,
  type EmailProviderActivityInput,
} from "../provider-activity";
import { describeProviderFailure } from "../provider-definition";
import type { EmailProviderAdapter } from "../types";

import { getEmailProviderRegistry } from "./email-provider-registry";

const MASKED_VALUE = "••••••••";

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

export class EmailProviderService extends BaseService {
  private emailProviders: EmailProvidersTable;
  private encryptionSecret: string | undefined;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
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

      // Three states, not two. `null` means no usable definition, so nothing is
      // known and everything is masked. Otherwise a path is revealed ONLY if the
      // provider declared it and did not mark it secret: a key the definition
      // does not mention at all -- a credential left behind by a plugin upgrade,
      // say -- is unknown rather than public, and the parsers strip unknown keys
      // for adapter construction without removing them from storage.
      const declared = secretPaths !== null && declaredPaths.has(path);
      const isSecret =
        secretPaths === null || !declared || secretPaths.has(path);
      masked[key] = isSecret ? MASKED_VALUE : value;
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
    pathPrefix = ""
  ): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(config)) {
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;

      if (value === MASKED_VALUE && secretPaths?.has(path)) {
        continue;
      }

      if (this.isPlainObject(value)) {
        cleaned[key] = this.stripMaskedConfigValues(value, secretPaths, path);
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
    const paths = Array.isArray(value) ? value : null;
    if (paths === null || paths.some(entry => typeof entry !== "string")) {
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
   * If `isDefault` is true, unsets the previous default provider
   * in a transaction to ensure only one default exists.
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
    getEmailProviderRegistry()
      .get(data.type)
      .validateConfig(data.configuration);

    const id = randomUUID();
    const now = new Date();

    const values = {
      id,
      name: data.name,
      type: data.type,
      fromEmail: data.fromEmail,
      fromName: data.fromName ?? null,
      configuration: this.encryptConfiguration(data.configuration),
      isDefault: data.isDefault ?? false,
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };

    try {
      if (values.isDefault) {
        // Unset any existing default first, then insert the new default provider

        await this.db
          .update(this.emailProviders)
          .set({ isDefault: false, updatedAt: now })
          .where(eq(this.emailProviders.isDefault, true));

        await this.db.insert(this.emailProviders).values(values);
      } else {
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

    return this.getProvider(id);
  }

  /**
   * Record a provider mutation, and never let recording break the mutation.
   *
   * The write has already committed by the time this runs. `recordActivity`
   * swallows its own failures for that reason, and this wrapper is the place
   * that turns one into a log line -- a trail that quietly stops being written
   * should be visible somewhere.
   */
  private async recordActivity(
    input: EmailProviderActivityInput
  ): Promise<void> {
    try {
      await recordProviderActivity(input);
    } catch (error) {
      this.logger.error("Failed to record email provider activity", {
        providerId: input.providerId,
        action: input.action,
        message: error instanceof Error ? error.message : String(error),
      });
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
              this.declaredSecretPaths(data.type as string)
            )
          : {};
      getEmailProviderRegistry()
        .get(data.type as string)
        .validateConfig(submitted);

      // Persist the replacement even when the update carried no configuration.
      // Validating `{}` and then not writing it leaves the PREVIOUS provider's
      // encrypted configuration under the new type -- so a permissive target
      // parser would receive stale credentials, which is exactly what
      // "a type change replaces rather than merges" is supposed to prevent.
      if (data.configuration === undefined) {
        updateData.configuration = this.encryptConfiguration(submitted);
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
        this.declaredSecretPaths(effectiveType)
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
      getEmailProviderRegistry()
        .get(effectiveType)
        .validateConfig(mergedConfig);

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
      configurationChanged =
        !existing.readable ||
        JSON.stringify(existingConfig) !== JSON.stringify(mergedConfig);

      updateData.configuration = this.encryptConfiguration(mergedConfig);
    }
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

    let updatedRows: number;
    try {
      if (data.isDefault === true) {
        // Unset any existing default first, then apply all updates to this provider

        await this.db
          .update(this.emailProviders)
          .set({ isDefault: false, updatedAt: now })
          .where(eq(this.emailProviders.isDefault, true));
      }

      const result = await this.db
        .update(this.emailProviders)
        .set(updateData)
        .where(eq(this.emailProviders.id, id));
      updatedRows = affectedRowCount(result, this.dialect);
    } catch (error) {
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
   * Unsets the previous default in a transaction to ensure
   * only one default provider exists at any time.
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
    if (!getEmailProviderRegistry().has(row.type)) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          "This provider's type is not registered on this server, so it cannot be made the default. Install the package that provides it first.",
        logContext: { id, type: row.type },
      });
    }

    const now = new Date();

    // Which providers are losing the default, read before the statement below
    // clears it. A promotion changes two rows, and afterwards nothing in the
    // record distinguishes the provider that was displaced from one that was
    // never the default at all -- so the trail could say what took over and
    // never what it took over from. Selected as a list rather than one row
    // because a broken state with two defaults must be recorded as it is,
    // not narrowed to whichever came back first.
    const displaced = await this.db
      .select({
        id: this.emailProviders.id,
        name: this.emailProviders.name,
        type: this.emailProviders.type,
      })
      .from(this.emailProviders)
      .where(eq(this.emailProviders.isDefault, true));

    // Unset any existing default first, then set the new one

    await this.db
      .update(this.emailProviders)
      .set({ isDefault: false, updatedAt: now })
      .where(eq(this.emailProviders.isDefault, true));

    // Recorded here rather than after the promotion, because this is where it
    // happened: the demotion stands whether or not the promotion below finds
    // its row. The provider being promoted is skipped -- a client retry
    // demotes and re-promotes the same row, and its final state is the state
    // it started in.
    for (const previous of displaced) {
      if (previous.id === id) continue;
      await this.recordActivity({
        action: "update",
        providerId: previous.id,
        providerName: previous.name,
        providerType: previous.type,
        changedFields: ["isDefault"],
        actor,
      });
    }

    const promotion = await this.db
      .update(this.emailProviders)
      .set({ isDefault: true, updatedAt: now })
      .where(eq(this.emailProviders.id, id));

    // The provider can be deleted between the read above and this statement,
    // in which case nothing was promoted. Recording it anyway would put a
    // promotion in the trail for a provider that never became the default --
    // the one claim this entry exists to make.
    if (affectedRowCount(promotion, this.dialect) === 0) {
      return this.getProvider(id);
    }

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

      // Fall back to the provider's own fromEmail when no test address is given
      const to = testEmail || provider.fromEmail;

      const result = await adapter.send({
        to,
        from,
        subject: "Nextly — Test Email",
        html: `<p>This is a test email from your <strong>${provider.name}</strong> email provider.</p><p>If you received this, your provider is configured correctly.</p>`,
      });

      return {
        success: result.success,
        error: result.success ? undefined : "Send returned unsuccessful",
      };
    } catch (error) {
      // Logged HERE, with the cause. Attaching an original error to a
      // NextlyError does not record it anywhere: this catch converts the error
      // into a result and the request ends, so a provider's actual diagnostic
      // was retained and then dropped — while the message told the operator to
      // go and read it. A promise about a log entry has to be made true by
      // something writing one.
      this.logger.error("Email provider test failed", {
        providerId: id,
        providerType: provider.type,
        mode,
        // Shared with the ordinary send path so the two cannot come to
        // disagree about how far down a `cause` chain to look.
        ...describeProviderFailure(error),
      });

      // A NextlyError's publicMessage is a decision about what may be shown.
      // Anything else is a message the throw site happened to interpolate, and
      // a contributed adapter throws with decrypted configuration in scope.
      return {
        success: false,
        error: NextlyError.is(error)
          ? error.publicMessage
          : "The test failed. The reason is in the server log.",
      };
    }
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
