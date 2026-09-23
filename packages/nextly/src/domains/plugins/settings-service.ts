/**
 * Where a plugin's configuration lives.
 *
 * A plugin that talks to anything outside the install needs somewhere to keep
 * credentials. Without this each one invents its own: an environment variable
 * the admin cannot change, a table it creates itself, or a JSON column with the
 * secret in plain text. This is one store, with the keys the plugin declared as
 * secrets encrypted at rest and never returned to the browser.
 *
 * The schema is the plugin's own zod object, so a value that does not fit is
 * refused at the boundary rather than discovered by whatever reads it later.
 *
 * @module domains/plugins/settings-service
 * @since 1.0.0
 */
import type { ZodObject, ZodRawShape, ZodType } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import { secretGenerations } from "../../shared/lib/secret-generations";
import { decrypt, encrypt } from "../../utils/encryption";

import {
  mapSecrets,
  redactSecrets,
  topLevelKeyHoldsSecret,
} from "./secret-paths";
import { OWNER_LOCK_KEY } from "./settings-store";

/** One stored top-level key. */
export interface PluginSettingRow {
  owner: string;
  key: string;
  value: string;
  isSecret: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * The storage this service reads and writes.
 *
 * An interface rather than the Drizzle table directly, so the policy — what is
 * secret, what is validated, what is redacted — can be tested without a
 * database, and so the one implementation that touches SQL is the only thing
 * that has to be right about three dialects.
 */
export interface PluginSettingsStore {
  read(owner: string): Promise<PluginSettingRow[]>;
  /**
   * Read, decide, and write as ONE atomic step.
   *
   * `computeRows` receives the stored rows and returns the rows to upsert. It
   * runs INSIDE the store's transaction with those rows locked, which is what
   * makes a read-modify-write safe: the merge that decides the new value is
   * the part that must not see a stale read, and a caller that merged first
   * and wrote afterwards lost whatever a concurrent writer had committed in
   * between.
   */
  mutate(
    owner: string,
    /**
     * The top-level keys this update will write.
     *
     * Named up front so the store can CLAIM them before it reads: a row lock
     * cannot hold a row that does not exist yet, so without this two first
     * writes for the same plugin both read nothing and the later one wins.
     */
    keys: readonly string[],
    computeRows: (
      current: PluginSettingRow[]
    ) => Promise<PluginSettingRow[]> | PluginSettingRow[]
  ): Promise<void>;
}

export interface PluginSettingsServiceDeps {
  owner: string;
  schema: ZodObject<ZodRawShape>;
  /** Declared secret paths, dot-separated, `*` matching any key. */
  secretPaths: readonly string[];
  store: PluginSettingsStore;
  /** The current secret, and any retired ones still able to read old rows. */
  secrets: () => string[];
}

/** A marker only this module writes, so a decrypt is never attempted on plain JSON. */
const SECRET_ENVELOPE = "enc:" as const;
/**
 * The escape marker for plaintext that would otherwise claim an envelope
 * prefix. Written by the escape walk before encryption, stripped by the read
 * walk before anything else looks at the string — so "enc:" in a stored
 * secret row always means ciphertext, and a public sibling value beginning
 * with it is ordinary text that round-trips.
 */
const ESCAPE_PREFIX = "enc!" as const;

/**
 * Keys that are never merged, because assigning them rewrites object
 * behaviour rather than data. A settings patch arrives from a request body.
 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * A value that merges key-by-key rather than replacing.
 *
 * Deliberately narrow: only a plain object. An array, a `Date` and a `null`
 * all REPLACE, because a patch naming one of those means the new value — and
 * merging arrays index-by-index would make removing an element impossible.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Apply `patch` over `current`, descending into nested objects.
 *
 * A key the patch does not mention keeps the stored value at every depth,
 * which is what lets a caller update one field of a group without resending
 * the secret beside it — a value it cannot resend, because it is never given
 * one to resend.
 */
function deepMergeSettings(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const key of Object.keys(patch)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const incoming = patch[key];
    const existing = out[key];
    out[key] =
      isPlainObject(existing) && isPlainObject(incoming)
        ? deepMergeSettings(existing, incoming)
        : incoming;
  }
  return out;
}

export class PluginSettingsService {
  constructor(private readonly deps: PluginSettingsServiceDeps) {}

  /**
   * Every setting, parsed by the plugin's schema, with secrets decrypted.
   *
   * Missing keys take their schema defaults rather than being absent, so a
   * plugin reading a setting it has never written gets the value it declared
   * rather than `undefined`.
   */
  async get<T extends Record<string, unknown>>(): Promise<T> {
    const stored = await this.readStored();
    return this.deps.schema.parse(stored) as T;
  }

  /**
   * The same settings with every secret replaced by `{ set }`.
   *
   * What the admin API returns. A secret that has been written is reported as
   * present and never as a value: the browser has no use for the plaintext,
   * and anything it receives can be read by anything else on the page.
   */
  async getRedacted(): Promise<unknown> {
    // Parsed first, so the admin sees every declared key rather than only the
    // ones written so far — a secret that has never been set still has to
    // appear, as `{ set: false }`, or the form has nothing to render.
    const parsed = this.deps.schema.parse(await this.readStored());
    return redactSecrets(parsed, this.deps.secretPaths);
  }

  /**
   * Validate a partial update, encrypt its secrets, and store it.
   *
   * Validated as a WHOLE settings object rather than as a patch: a schema
   * describes a complete value, and checking the patch alone would accept a
   * change that makes the result invalid.
   */
  async set(
    patch: Record<string, unknown>,
    opts?: { actorUserId?: string }
  ): Promise<void> {
    // The merge happens INSIDE the store's transaction, against rows it has
    // locked. Reading first and writing afterwards let two callers patching
    // different nested fields under one key both start from the same stored
    // value: each merged correctly on its own, and the second write put back
    // what the first had just changed. A rotated `clientSecret` undone by an
    // unrelated `clientId` edit is the shape that costs the most.
    await this.deps.store.mutate(this.deps.owner, Object.keys(patch), stored =>
      this.rowsForUpdate(stored, patch, opts)
    );
  }

  /**
   * Every row one update must write: the patch's own keys, plus the
   * re-encryption of stored rows a newer manifest has made secret.
   *
   * Split from `rowsForPatch` because the migration needs the RAW rows —
   * `decodeRows` answers values, and whether a row was STORED as plaintext
   * is a fact about the row, not the value.
   */
  private rowsForUpdate(
    stored: PluginSettingRow[],
    patch: Record<string, unknown>,
    opts?: { actorUserId?: string }
  ): PluginSettingRow[] {
    const current = this.decodeRows(stored);
    const rows = this.rowsForPatch(current, patch, opts);

    // A key that becomes secret in a newer plugin version keeps whatever
    // shape its row was written in, and a row written while it was public is
    // plaintext at rest forever: nothing rewrites a key the patch does not
    // mention, and the admin is never handed the plaintext to echo back.
    // Reading is already safe — redaction follows the manifest, not the row —
    // but the at-rest encryption the manifest now promises was never applied
    // to the old value. Rewriting it here, inside the same serialized
    // transaction as the patch, is the one place the migration can happen
    // without a second writer racing it.
    //
    // A key the PATCH itself writes is excluded: its row is already the new
    // value under the new declaration, and the store upserts these rows in
    // order — a migration row appended behind it is built from the OLD stored
    // value and would silently overwrite the fresh one, discarding the first
    // rotation of a newly protected credential while the API reported success.
    const migrated = stored
      .filter(
        row =>
          row.key !== OWNER_LOCK_KEY &&
          !Object.hasOwn(patch, row.key) &&
          !row.isSecret &&
          Object.hasOwn(current, row.key) &&
          topLevelKeyHoldsSecret(row.key, this.deps.secretPaths)
      )
      .map(row => this.rowFor(row.key, current[row.key], opts));

    return [...rows, ...migrated];
  }

  /**
   * Turn a patch into the rows to store, given what is currently stored.
   *
   * Pure with respect to `current`, so the caller can run it inside the
   * store's transaction against the rows that transaction locked.
   */
  private rowsForPatch(
    current: Record<string, unknown>,
    patch: Record<string, unknown>,
    opts?: { actorUserId?: string }
  ): PluginSettingRow[] {
    // DEEP, because a shallow spread replaces a nested object wholesale. A
    // group holding both a normal field and a secret — the ordinary shape for
    // a provider's `clientId` and `clientSecret` — lost the secret whenever
    // only the normal field was patched, and the admin cannot resend what it
    // only ever received as `{ set: true }`: a required secret then failed
    // validation, and a defaulted one was silently reset over its ciphertext.
    const merged = deepMergeSettings(current, patch);

    const parsed = this.deps.schema.safeParse(merged);
    if (!parsed.success) {
      throw NextlyError.validation({
        errors: parsed.error.issues.map(issue => ({
          path: issue.path.join(".") || "settings",
          code: issue.code.toUpperCase(),
          message: issue.message,
        })),
        logContext: { plugin: this.deps.owner },
      });
    }

    // The empty key is REFUSED before anything else looks at the patch. The
    // store contends on a row keyed with it to serialize writers for one
    // plugin, and deletes that row before committing — so a settings key
    // spelled the same way would be silently removed by the next write. A
    // schema cannot usefully declare it either; refusing it here is what makes
    // the store's choice of sentinel safe rather than merely unlikely.
    if (Object.hasOwn(patch, OWNER_LOCK_KEY)) {
      throw NextlyError.validation({
        errors: [
          {
            path: OWNER_LOCK_KEY,
            code: "INVALID_KEY",
            message: "A settings key cannot be the empty string.",
          },
        ],
        logContext: { plugin: this.deps.owner },
      });
    }

    // A plain zod object STRIPS what it does not know, so `{ typo: 1 }` parses
    // happily and `parsed.data.typo` is then undefined. Iterating the original
    // patch wrote `JSON.stringify(undefined)` — the value `undefined`, not a
    // string — into a NOT NULL text column, turning a misspelled or stale
    // field into a database error instead of an answer naming the problem.
    const unknown = Object.keys(patch).filter(
      key => !Object.hasOwn(parsed.data, key)
    );
    if (unknown.length > 0) {
      throw NextlyError.validation({
        errors: unknown.map(key => ({
          path: key,
          code: "UNKNOWN_KEY",
          message: `"${key}" is not declared by this plugin's settings schema.`,
        })),
        logContext: { plugin: this.deps.owner },
      });
    }

    // The PATCH's keys, not the parsed result's. Parsing fills in every
    // schema default, so writing those would turn a change of one field into
    // a reset of the others — a `port` update silently overwriting a stored
    // `clientSecret` with the empty default. The refusal above is what makes
    // this safe: every remaining key is known to be present in `parsed.data`,
    // so no `undefined` can reach the column.
    return Object.keys(patch).map(key =>
      this.rowFor(key, parsed.data[key], opts)
    );
  }

  /**
   * One row to store for a key, whichever update is writing it.
   *
   * The value is proven STORABLE first. A settings row is JSON in a text
   * column, so a value the schema accepts but JSON cannot carry — a `Date`,
   * a transformed type, a bigint — writes happily and makes every LATER read
   * fail: what comes back out of the row is JSON, and the same schema is
   * asked to parse it again. `z.string().transform(Number)` is the quiet
   * version — the number stores, and the next parse rejects it.
   */
  private rowFor(
    key: string,
    value: unknown,
    opts?: { actorUserId?: string }
  ): PluginSettingRow {
    // Serialize, then feed what actually comes back through the field's own
    // schema. Checking only serialization leaves the `z.date()` case: a Date
    // serializes fine, and the string it becomes is what the field refuses.
    let encoded: unknown;
    try {
      encoded = JSON.parse(JSON.stringify(value));
    } catch {
      throw this.unstorableValue(
        key,
        "its schema produces a value JSON cannot serialize, such as a bigint"
      );
    }
    // The shape's values are declared as zod's widest type, which does not
    // carry the parse methods on its TypeScript face; every value a ZodObject
    // holds is a full schema at runtime, so this narrows to the type that
    // states what the call does rather than asserting anything new.
    const field = this.deps.schema.shape[key] as ZodType | undefined;
    if (field) {
      const recheck = field.safeParse(encoded);
      if (!recheck.success) {
        throw this.unstorableValue(
          key,
          "its schema produces a value that does not survive storage as JSON, such as a `z.date()`"
        );
      }
    }
    const holdsSecret = topLevelKeyHoldsSecret(key, this.deps.secretPaths);
    return {
      owner: this.deps.owner,
      key,
      value: JSON.stringify(
        holdsSecret
          ? this.encryptSecrets(escapeEnvelopeClaimants(value), [key])
          : value
      ),
      isSecret: holdsSecret,
      updatedAt: new Date(),
      updatedBy: opts?.actorUserId ?? null,
    };
  }

  /** The refusal for a settings value that cannot live in a settings row. */
  private unstorableValue(key: string, why: string): NextlyError {
    return NextlyError.validation({
      errors: [
        {
          path: key,
          code: "NOT_STORABLE",
          message: `The "${key}" setting cannot be stored: ${why}. Store it as a JSON-native value (an ISO string rather than a date, for example) instead.`,
        },
      ],
      logContext: { plugin: this.deps.owner },
    });
  }

  /** The stored settings, decrypted, before the schema is applied. */
  private async readStored(): Promise<Record<string, unknown>> {
    return this.decodeRows(await this.deps.store.read(this.deps.owner));
  }

  /**
   * Stored rows as a settings object.
   *
   * Split from `readStored` so the write path can decode the rows the
   * TRANSACTION read, rather than issuing a second read of its own — which is
   * the read whose staleness this whole path exists to avoid.
   */
  private decodeRows(rows: PluginSettingRow[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      // The store's lock row is not settings. It is deleted before that
      // transaction commits, so a read should never meet one — skipping it
      // costs nothing and means a read taken mid-write could not decode a
      // placeholder as a plugin's stored value.
      if (row.key === OWNER_LOCK_KEY) continue;
      const parsed: unknown = JSON.parse(row.value);
      // Decoded by ENVELOPE, not by the current manifest's paths: a plugin
      // update can remove or rename a secret path, and a path-driven decode
      // then left the old encrypted leaf as its literal `enc:...` text —
      // `get()` returned corrupted configuration, and a later patch could
      // persist that ciphertext as a public value, losing the credential.
      // The envelope is self-describing, so every encrypted leaf in a row
      // stored as secret is opened whatever the manifest now calls secret;
      // where it is RE-encrypted is a write-time decision, made against the
      // paths the current manifest declares.
      out[row.key] = row.isSecret ? this.decryptEnvelopes(parsed) : parsed;
    }
    return out;
  }

  /**
   * Open every encrypted leaf in a stored secret row, wherever it sits.
   *
   * The path-driven walk above still serves reads that want to know what the
   * CURRENT manifest considers secret; this one answers the storage's own
   * question — what did a past manifest encrypt — which only the envelope
   * markers can say. Plaintext leaves pass through untouched, which is what
   * lets a row written before a path became secret coexist with encrypted
   * ones written after.
   *
   * A `enc:`-shaped string is an ENVELOPE, and one no secret generation can
   * open fails the read explicitly: that is a credential encrypted under a
   * key the install no longer configures, and handing its ciphertext back as
   * configuration would have the plugin authenticate with the envelope text —
   * a lost secret masquerading as a value. Plaintext that merely begins with
   * the prefix cannot reach here: writes escape it, so the prefix belongs to
   * ciphertext alone.
   */
  private decryptEnvelopes(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.decryptEnvelopes(item));
    }
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        out[key] = this.decryptEnvelopes(item);
      }
      return out;
    }
    if (typeof value === "string" && value.startsWith(ESCAPE_PREFIX)) {
      return value.slice(ESCAPE_PREFIX.length);
    }
    if (typeof value === "string" && value.startsWith(SECRET_ENVELOPE)) {
      return this.decryptEnvelope(value, []);
    }
    return value;
  }

  private encryptSecrets(value: unknown, path: string[]): unknown {
    const [current] = this.deps.secrets();
    if (!current) {
      throw NextlyError.internal({
        logContext: {
          reason: "no secret configured for plugin settings encryption",
          plugin: this.deps.owner,
        },
      });
    }
    return mapSecrets(
      value,
      this.deps.secretPaths,
      (secret, at) => {
        if (secret === undefined || secret === null) return secret;
        // A secret is a credential, which is a string. Anything else is a
        // schema mistake, and stringifying an object would store
        // "[object Object]" as though it were the credential.
        if (typeof secret !== "string") {
          throw NextlyError.validation({
            errors: [
              {
                path: at.join("."),
                code: "INVALID",
                message: "A secret setting must be a string.",
              },
            ],
            logContext: { plugin: this.deps.owner },
          });
        }
        return `${SECRET_ENVELOPE}${encrypt(secret, current)}`;
      },
      path
    );
  }

  private decryptSecrets(value: unknown, path: string[]): unknown {
    return mapSecrets(value, this.deps.secretPaths, this.decryptEnvelope, path);
  }

  /**
   * Open one `enc:`-enveloped value, trying every secret generation in turn.
   *
   * After a secret rotation the current key cannot read rows written under
   * the previous one, and a value that silently fails to decrypt is a
   * credential that stops working with no way to tell why.
   */
  private decryptEnvelope = (secret: unknown, path: string[] = []): unknown => {
    if (typeof secret !== "string" || !secret.startsWith(SECRET_ENVELOPE)) {
      return secret;
    }
    const ciphertext = secret.slice(SECRET_ENVELOPE.length);
    for (const generation of this.deps.secrets()) {
      try {
        return decrypt(ciphertext, generation);
      } catch {
        continue;
      }
    }
    throw NextlyError.internal({
      logContext: {
        reason:
          "plugin setting could not be decrypted with any secret generation",
        plugin: this.deps.owner,
        path: path.join("."),
      },
    });
  };
}

/** The secret generations this install can read with, newest first. */
export function pluginSettingsSecrets(env: {
  NEXTLY_SECRET?: string;
  NEXTLY_SECRET_PREVIOUS?: string;
}): string[] {
  return secretGenerations(
    env.NEXTLY_SECRET,
    env.NEXTLY_SECRET_PREVIOUS
  ).filter(
    (generation): generation is string => typeof generation === "string"
  );
}

/**
 * Escape every plaintext leaf that would claim an envelope marker, so the
 * markers in a stored secret row belong to ciphertext alone.
 *
 * A module-level walk beside the service's other pure helpers, because the
 * question — does any plaintext leaf here look like an envelope — is about
 * the value's shape, not the plugin's policy. Claims are prefixed with the
 * escape marker (doubling for values that already carry it), and the read
 * walk strips exactly one marker, so any plaintext round-trips whatever it
 * begins with. Runs BEFORE encryption, whose own envelopes are appended
 * after and never pass through here again.
 */
function escapeEnvelopeClaimants(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => escapeEnvelopeClaimants(item));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = escapeEnvelopeClaimants(item);
    }
    return out;
  }
  if (
    typeof value === "string" &&
    (value.startsWith(ESCAPE_PREFIX) || value.startsWith(SECRET_ENVELOPE))
  ) {
    return `${ESCAPE_PREFIX}${value}`;
  }
  return value;
}
