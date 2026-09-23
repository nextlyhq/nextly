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
import type { ZodObject, ZodRawShape } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import { secretGenerations } from "../../shared/lib/secret-generations";
import { decrypt, encrypt } from "../../utils/encryption";

import {
  mapSecrets,
  redactSecrets,
  topLevelKeyHoldsSecret,
} from "./secret-paths";

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
    await this.deps.store.mutate(this.deps.owner, Object.keys(patch), current =>
      this.rowsForPatch(this.decodeRows(current), patch, opts)
    );
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

    const now = new Date();
    // The PATCH's keys, not the parsed result's. Parsing fills in every
    // schema default, so writing those would turn a change of one field into
    // a reset of the others — a `port` update silently overwriting a stored
    // `clientSecret` with the empty default. The refusal above is what makes
    // this safe: every remaining key is known to be present in `parsed.data`,
    // so no `undefined` can reach the column.
    const rows: PluginSettingRow[] = Object.keys(patch).map(key => {
      const value = parsed.data[key];
      const holdsSecret = topLevelKeyHoldsSecret(key, this.deps.secretPaths);
      return {
        owner: this.deps.owner,
        key,
        value: JSON.stringify(
          holdsSecret ? this.encryptSecrets(value, [key]) : value
        ),
        isSecret: holdsSecret,
        updatedAt: now,
        updatedBy: opts?.actorUserId ?? null,
      };
    });

    return rows;
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
      const parsed: unknown = JSON.parse(row.value);
      out[row.key] = row.isSecret
        ? this.decryptSecrets(parsed, [row.key])
        : parsed;
    }
    return out;
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
    return mapSecrets(
      value,
      this.deps.secretPaths,
      secret => {
        if (typeof secret !== "string" || !secret.startsWith(SECRET_ENVELOPE)) {
          return secret;
        }
        const ciphertext = secret.slice(SECRET_ENVELOPE.length);
        // Every generation in turn: after a secret rotation the current key
        // cannot read rows written under the previous one, and a value that
        // silently fails to decrypt is a credential that stops working with no
        // way to tell why.
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
      },
      path
    );
  }
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
