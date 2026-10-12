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
import { isDeepStrictEqual } from "node:util";

import type { ZodObject, ZodRawShape, ZodType } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import { getNextlyLogger } from "../../observability/logger";
import { secretGenerations } from "../../shared/lib/secret-generations";

import {
  hasSecretValue,
  isSecretPath,
  mapSecrets,
  redactSecrets,
  topLevelKeyHoldsSecret,
  valueAtPath,
} from "./secret-paths";
import {
  openSetting,
  sealSetting,
  type UnreadableReason,
} from "./settings-crypto";
import { OWNER_LOCK_KEY } from "./settings-store";

/** One stored top-level key. */
export interface PluginSettingRow {
  owner: string;
  key: string;
  value: string;
  isSecret: boolean;
  updatedAt: Date;
  updatedBy: string | null;
  /**
   * Set on a row an update DELETES rather than writes: a top-level key the
   * patch named with `null`. Never read back from storage.
   */
  remove?: true;
}

/** One problem the stored settings have against the plugin's schema. */
export interface SettingsIssue {
  path: string;
  message: string;
}

/** What one settings key may hold once stored, across all three dialects. */
export const MAX_SETTING_BYTES = 256 * 1024;

/**
 * What an encrypted leaf decodes to when no configured secret can open it.
 *
 * A string, so the value keeps the shape the schema expects of a secret, and
 * one no stored value can equal: plaintext cannot hold a NUL-delimited marker
 * this module never writes. Every path that meets one decides what it means —
 * `get()` refuses, the admin view reports `{ set: true, readable: false }`,
 * and a write must replace it rather than store it.
 */
const UNREADABLE = "\u0000nextly:unreadable-secret\u0000";

/** Whether a decoded value holds an unreadable secret anywhere inside it. */
function unreadablePaths(value: unknown, path: string[]): string[][] {
  if (value === UNREADABLE) return [path];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) =>
      unreadablePaths(item, [...path, String(i)])
    );
  }
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      unreadablePaths(item, [...path, key])
    );
  }
  return [];
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
     * The top-level keys this update will write. The store serializes every
     * writer for one plugin on a single owner row it claims before reading,
     * so it does not need these to lock; they describe the update.
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
 * Apply `patch` over `current` with JSON merge-patch semantics (RFC 7396).
 *
 * A key the patch does not mention keeps the stored value at every depth,
 * which is what lets a caller update one field of a group without resending
 * the secret beside it — a value it cannot resend, because it is never given
 * one to resend. A key the patch sets to `null` is REMOVED: without that, an
 * entry of a record could never be deleted and an optional value could never
 * be cleared, only overwritten.
 */
function deepMergeSettings(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const key of Object.keys(patch)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const incoming = patch[key];
    if (incoming === null) {
      delete out[key];
      continue;
    }
    const existing = out[key];
    // An object merges into what is stored there, or into an empty object
    // when nothing mergeable is: RFC 7396 applies the patch to `{}` in that
    // case, so a `null` inside a NEW group removes its member rather than
    // being stored as a value.
    out[key] = isPlainObject(incoming)
      ? deepMergeSettings(isPlainObject(existing) ? existing : {}, incoming)
      : incoming;
  }
  return out;
}

/**
 * Every object path the patch names that the parsed result does not contain.
 *
 * A plain zod object strips keys it does not declare, at every depth, so a
 * typo one level down — `providers.google.clientSecrett` — parsed happily and
 * the value it carried was silently dropped. A deletion (`null`) names a key
 * on purpose to remove it, so it is not an unknown key.
 *
 * Arrays are walked too, element by element with the index as the segment: a
 * typo inside a list item is dropped the same way, and since a patch replaces
 * an array whole, element `i` of the patch is element `i` of the result. Only
 * when the lengths agree, though: a transform that filters or extends a list
 * leaves no pairing by index to trust. Like the object walk, this reads the
 * parsed value as the patch's own structure, which a transform that moves
 * items or renames keys does not keep.
 */
function unknownPatchPaths(
  patch: unknown,
  parsed: unknown,
  prefix: string[] = []
): string[] {
  if (Array.isArray(patch) && Array.isArray(parsed)) {
    if (patch.length !== parsed.length) return [];
    return patch.flatMap((item, i) =>
      unknownPatchPaths(item, parsed[i], [...prefix, String(i)])
    );
  }
  if (!isPlainObject(patch) || !isPlainObject(parsed)) return [];
  return Object.entries(patch).flatMap(([key, value]) => {
    if (value === null || UNSAFE_KEYS.has(key)) return [];
    if (!Object.hasOwn(parsed, key)) return [[...prefix, key].join(".")];
    return unknownPatchPaths(value, parsed[key], [...prefix, key]);
  });
}

/**
 * The redacted view of a store nothing was ever saved to: every declared
 * secret appears as `{ set: false }`, and a wildcard path is skipped — it
 * names no key until saved settings give it instances to name.
 */
function unsetSecretsView(
  secretPaths: readonly string[]
): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const path of secretPaths) {
    if (path.includes("*")) continue;
    const parts = path.split(".");
    let node = view;
    for (const part of parts.slice(0, -1)) {
      const existing = node[part];
      node[part] =
        typeof existing === "object" && existing !== null ? existing : {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = { set: false };
  }
  return view;
}

/**
 * Fill the unset view with the defaults the schema still offers: a key
 * that parses on its own when absent carries a default the admin form
 * should see. A secret path reaching INTO a copied default prunes exactly
 * what it reaches — an ordinary sibling in the same group keeps its
 * default — and a key a secret path names outright is never merged.
 * Required keys fail their absent parse and stay unset.
 */
function mergeSchemaDefaults(
  schema: unknown,
  secretPaths: readonly string[],
  view: Record<string, unknown>
): void {
  const shape = (schema as { shape?: Record<string, unknown> } | null)?.shape;
  if (!shape) return;
  for (const [key, field] of Object.entries(shape)) {
    if (view[key] !== undefined) continue;
    const merged = defaultedAndPruned(key, field, secretPaths);
    if (merged !== undefined) view[key] = merged;
  }
}

/**
 * The pruned default a single shape key offers, or undefined when it has
 * none worth showing: absent-parse failures (a required key), keys a secret
 * path names outright, and groups whose default pruned down to nothing.
 */
function defaultedAndPruned(
  key: string,
  field: unknown,
  secretPaths: readonly string[]
): unknown {
  if (secretPaths.some(path => path === key)) return undefined;
  const parsed = (
    field as {
      safeParse?: (value: undefined) => { success: boolean; data?: unknown };
    } | null
  )?.safeParse?.(undefined);
  if (!parsed?.success) return undefined;
  const pruned = pruneSecretPaths(parsed.data, [key], secretPaths);
  const nothingLeft =
    pruned !== null &&
    typeof pruned === "object" &&
    !Array.isArray(pruned) &&
    Object.keys(pruned).length === 0;
  return nothingLeft ? undefined : pruned;
}

/**
 * A copied default with everything a secret path reaches marked unset.
 *
 * Matched with `isSecretPath`, the rule storage and the redactor use, so the
 * pruned view behaves like the successful-parse path beside it: a group whose
 * key merely collides with a secret field name is left alone, the same way
 * redaction leaves it.
 */
function pruneSecretPaths(
  node: unknown,
  prefix: string[],
  secretPaths: readonly string[]
): unknown {
  if (Array.isArray(node)) {
    return node.map((item, i) =>
      pruneSecretPaths(item, [...prefix, String(i)], secretPaths)
    );
  }
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    // Marked rather than cut: the operator still has to see the credential
    // is missing, or the form offers no place to learn it needs configuring.
    out[k] = isSecretPath([...prefix, k], secretPaths)
      ? { set: false }
      : pruneSecretPaths(v, [...prefix, k], secretPaths);
  }
  return out;
}

/** Stored rows decoded, with what the decode found along the way. */
interface DecodedSettings {
  /** The settings object; an unreadable secret appears as `UNREADABLE`. */
  values: Record<string, unknown>;
  /** Top-level keys holding a secret no configured generation can open. */
  unreadableKeys: Set<string>;
  /** Why each unreadable leaf did not open, by its dot-joined path. */
  unreadableReasons: Map<string, UnreadableReason>;
  /** Top-level keys holding a secret opened with a RETIRED generation. */
  staleKeys: Set<string>;
  /**
   * Every leaf that was stored ENCRYPTED, by top-level key, as its full path.
   *
   * What a past manifest encrypted is known only from the envelopes, and the
   * current manifest may no longer name it. Without this the view returned
   * such a leaf decrypted, and a rewrite stored it as plaintext.
   */
  sealedPaths: Map<string, string[][]>;
}

export class PluginSettingsService {
  constructor(private readonly deps: PluginSettingsServiceDeps) {}

  /**
   * Every setting, parsed by the plugin's schema, with secrets decrypted.
   *
   * Missing keys take their schema defaults rather than being absent, so a
   * plugin reading a setting it has never written gets the value it declared
   * rather than `undefined`.
   *
   * Refuses, naming the plugin and the paths, when a secret cannot be
   * decrypted or the stored settings no longer fit the schema — a plugin
   * update that added a required key, say. A raw `ZodError` escaping into the
   * plugin said neither which plugin nor what to do about it.
   */
  async get<T extends Record<string, unknown>>(): Promise<T> {
    const { values, unreadableKeys, unreadableReasons } =
      await this.readStored();
    // Only keys the schema still declares: a key a newer plugin version
    // dropped is not read, so a lost secret under it must not fail the read —
    // and it could not be entered again, since a write refuses the key.
    const unreadable = [...unreadableKeys]
      .filter(key => Object.hasOwn(this.deps.schema.shape, key))
      .flatMap(key => unreadablePaths(values[key], [key]));
    if (unreadable.length > 0) {
      const paths = unreadable.map(path => path.join("."));
      // The reason beside each path: a lost key, a tampered value and a
      // damaged envelope are fixed in different places.
      throw this.misconfigured("stored-secret-unreadable", {
        paths,
        reasons: Object.fromEntries(
          paths.map(path => [path, unreadableReasons.get(path)])
        ),
      });
    }
    const parsed = this.deps.schema.safeParse(omitKeys(values, unreadableKeys));
    if (!parsed.success) {
      throw this.misconfigured("stored-settings-invalid", {
        issues: parsed.error.issues.map(issue => ({
          path: issue.path.join(".") || "settings",
          message: issue.message,
        })),
      });
    }
    return parsed.data as T;
  }

  /**
   * The error a plugin's read raises when the install's stored settings are
   * not usable.
   *
   * An INTERNAL error, with the detail in the log: this is the install's
   * configuration, not the caller's request. A public plugin route — a webhook,
   * an OAuth callback — reading its settings would otherwise answer a 400
   * carrying setting paths and secret-variable names to whoever called it,
   * and a server fault would never reach the alerting that watches 5xx.
   * The admin settings page shows the same problems through `view()`.
   */
  private misconfigured(
    reason: string,
    detail: Record<string, unknown>
  ): NextlyError {
    return NextlyError.internal({
      logContext: { reason, plugin: this.deps.owner, ...detail },
    });
  }

  /**
   * The same settings with every secret replaced by `{ set }`.
   *
   * What the admin API returns. A secret that has been written is reported as
   * present and never as a value: the browser has no use for the plaintext,
   * and anything it receives can be read by anything else on the page.
   */
  async getRedacted(): Promise<unknown> {
    return (await this.view()).settings;
  }

  /**
   * The redacted settings, and what is wrong with them against the schema.
   *
   * The form has to render whatever state storage is in, because the form is
   * how that state gets fixed:
   *
   * - a store nothing was saved to shows every declared key with its default,
   *   and every declared secret as `{ set: false }`;
   * - a store that no longer parses — a plugin update added a required key —
   *   shows what IS stored, plus defaults and unset secrets for the rest, with
   *   the issues beside it. Throwing there answered 500, and the form that
   *   should prompt for the new key could not render;
   * - a secret no configured generation can decrypt is reported as
   *   `{ set: true, readable: false }` rather than failing the whole read, so
   *   the operator can see it and enter it again.
   */
  async view(): Promise<{ settings: unknown; issues: SettingsIssue[] }> {
    const { values, unreadableKeys, sealedPaths } = await this.readStored();
    const readable = omitKeys(values, unreadableKeys);
    const parsed = this.schemaWithout(unreadableKeys).safeParse(readable);

    const saved = this.savedSecretCheck(readable);
    // Only a string is a stored secret. A default copied into the view has
    // its secrets already marked `{ set: false }`, and that object must not
    // be mistaken for a value someone saved.
    const isSet = (secret: unknown, path: string[]) =>
      typeof secret === "string" && saved(secret, path);

    let redacted: Record<string, unknown>;
    let issues: SettingsIssue[] = [];
    if (parsed.success) {
      redacted = redactSecrets(
        parsed.data,
        this.deps.secretPaths,
        isSet
      ) as Record<string, unknown>;
    } else {
      // Stored values win; the schema's defaults fill the keys nothing is
      // stored under, and every declared secret still absent is shown unset.
      // Nothing a secret path reaches is merged from a default, and the
      // redactor is the second wall behind that.
      // Only keys the schema still declares are shown: a key a newer version
      // dropped is not configuration any more, and copying it in handed the
      // browser whatever it held.
      const settings: Record<string, unknown> = {};
      mergeSchemaDefaults(this.deps.schema, this.deps.secretPaths, settings);
      Object.assign(settings, pickKeys(readable, this.deps.schema.shape));
      redacted = redactSecrets(
        settings,
        this.deps.secretPaths,
        isSet
      ) as Record<string, unknown>;
      fillAbsent(redacted, unsetSecretsView(this.deps.secretPaths));
      // A store nothing was saved to is not in error: every required key is
      // simply waiting for its first save.
      if (Object.keys(readable).length > 0) {
        issues = parsed.error.issues.map(issue => ({
          path: issue.path.join(".") || "settings",
          message: issue.message,
        }));
      }
    }
    for (const key of unreadableKeys) {
      if (!Object.hasOwn(this.deps.schema.shape, key)) continue;
      redacted[key] = redactUnreadable(
        values[key],
        [key],
        this.deps.secretPaths
      );
    }
    // Every leaf that was stored encrypted is redacted, whether or not the
    // current manifest still declares its path: a plugin update that renames
    // or drops a secret path does not make the stored credential public.
    redactSealedLeaves(redacted, sealedPaths);
    return { settings: redacted, issues };
  }

  /**
   * The plugin's schema with `keys` made optional.
   *
   * For validating what CAN be read: a key holding a secret nothing can
   * decrypt has no value to check, and demanding one refused every other
   * write and read until the operator had somehow re-entered it first.
   *
   * The object-level refinements (`.refine`, `.superRefine`) are left out of
   * this schema: zod's `.partial()` throws on an object that carries them,
   * which turned one unreadable key into a failed view and a refusal of every
   * unrelated write. A rule spanning keys cannot be checked while one of them
   * has no value anyway. The clone keeps the rest of the definition, so a
   * root `.strict()`, `.passthrough()` or `.catchall()` still applies.
   *
   * Only keys the schema declares count. When none of `keys` is declared — a
   * lost secret under a key a plugin update dropped — every key the schema
   * checks has its value, so the full schema applies, refinements included:
   * setting them aside then accepted a write that every later `get()`
   * refused.
   */
  private schemaWithout(keys: ReadonlySet<string>): ZodObject<ZodRawShape> {
    const { schema } = this.deps;
    const mask: Record<string, true> = {};
    for (const key of keys) {
      if (Object.hasOwn(schema.shape, key)) mask[key] = true;
    }
    if (Object.keys(mask).length === 0) return schema;
    return schema.clone({ ...schema.def, checks: [] }).partial(mask);
  }

  /**
   * Whether the secret the schema placed at a path came from a saved value.
   *
   * Saved when the stored settings hold a value at that path. Also saved when
   * the schema READ it from somewhere else: a `preprocess` or `transform` from
   * an older layout moves a stored key, so nothing is stored at the new path
   * although the credential there is a saved one. What is not saved is a
   * schema default, which the plugin runs with but no one configured.
   *
   * The defaults are what the schema makes of empty settings, parsed twice: a
   * default that differs between the two is generated, and a value read from
   * storage is instead the same on every parse of it. When empty settings do
   * not parse there is nothing to tell a default from a saved value, so only
   * a value stored at the path counts — reporting a saved key unset costs the
   * operator a re-entry, while reporting a default set lets them skip a
   * credential nothing configured.
   */
  private savedSecretCheck(
    stored: Record<string, unknown>
  ): (secret: unknown, path: string[]) => boolean {
    const { schema } = this.deps;
    const empty = [schema.safeParse({}), schema.safeParse({})];
    const reread = schema.safeParse(stored);

    return (secret, path) => {
      if (hasSecretValue(valueAtPath(stored, path))) return true;
      if (!hasSecretValue(secret)) return false;
      const [first, second] = empty;
      if (!first.success || !second.success) return false;

      const fallback = valueAtPath(first.data, path);
      if (isDeepStrictEqual(fallback, valueAtPath(second.data, path))) {
        return !isDeepStrictEqual(secret, fallback);
      }
      return (
        reread.success &&
        isDeepStrictEqual(secret, valueAtPath(reread.data, path))
      );
    };
  }

  /**
   * Validate a partial update, encrypt its secrets, and store it.
   *
   * Validated as a WHOLE settings object rather than as a patch: a schema
   * describes a complete value, and checking the patch alone would accept a
   * change that makes the result invalid. `null` removes a key, at any depth.
   *
   * Resolves to the top-level keys whose stored value the update changed, as
   * names only: what an audit entry records, and what tells a listener whether
   * anything it caches moved. A key the patch resent unchanged is not in it.
   */
  async set(
    patch: Record<string, unknown>,
    opts?: { actorUserId?: string }
  ): Promise<string[]> {
    // The merge happens INSIDE the store's transaction, against rows it has
    // locked. Reading first and writing afterwards let two callers patching
    // different nested fields under one key both start from the same stored
    // value: each merged correctly on its own, and the second write put back
    // what the first had just changed. A rotated `clientSecret` undone by an
    // unrelated `clientId` edit is the shape that costs the most.
    let changedKeys: string[] = [];
    await this.deps.store.mutate(
      this.deps.owner,
      Object.keys(patch),
      stored => {
        const update = this.rowsForUpdate(stored, patch, opts);
        changedKeys = update.changedKeys;
        return update.rows;
      }
    );
    return changedKeys;
  }

  /**
   * Every row one update must write: the patch's own keys, plus the
   * re-encryption of stored rows the manifest or the secret has moved on
   * from.
   *
   * Two kinds of stored row are rewritten although the patch does not name
   * them, inside the same serialized transaction, which is the one place this
   * can happen without a second writer racing it:
   *
   * - a key that became secret in a newer plugin version, whose row was
   *   written while it was public and is plaintext at rest;
   * - a row whose secrets were opened with a RETIRED generation, re-sealed
   *   under the current one so the retired secret can eventually be dropped.
   *
   * A key the PATCH itself writes is excluded from both: its row is already
   * the new value, and a rewrite built from the old stored value appended
   * behind it would overwrite the fresh one.
   */
  private rowsForUpdate(
    stored: PluginSettingRow[],
    patch: Record<string, unknown>,
    opts?: { actorUserId?: string }
  ): { rows: PluginSettingRow[]; changedKeys: string[] } {
    const decoded = this.decodeRows(stored);
    const { rows, changedKeys } = this.rowsForPatch(decoded, patch, opts);

    const rewritten = stored
      .filter(
        row =>
          row.key !== OWNER_LOCK_KEY &&
          !Object.hasOwn(patch, row.key) &&
          !decoded.unreadableKeys.has(row.key) &&
          Object.hasOwn(decoded.values, row.key) &&
          (decoded.staleKeys.has(row.key) ||
            (!row.isSecret &&
              topLevelKeyHoldsSecret(row.key, this.deps.secretPaths)))
      )
      .map(row =>
        this.rowFor(
          row.key,
          decoded.values[row.key],
          opts,
          decoded.sealedPaths.get(row.key)
        )
      );

    return { rows: [...rows, ...rewritten], changedKeys };
  }

  /**
   * Turn a patch into the rows to store, given what is currently stored.
   *
   * Pure with respect to `decoded`, so the caller can run it inside the
   * store's transaction against the rows that transaction locked.
   */
  private rowsForPatch(
    decoded: DecodedSettings,
    patch: Record<string, unknown>,
    opts?: { actorUserId?: string }
  ): { rows: PluginSettingRow[]; changedKeys: string[] } {
    // The empty key is REFUSED before anything else looks at the patch. The
    // store contends on a row keyed with it to serialize writers for one
    // plugin, and deletes that row before committing — so a settings key
    // spelled the same way would be silently removed by the next write. A
    // schema cannot usefully declare it either; refusing it here is what makes
    // the store's choice of sentinel safe rather than merely unlikely.
    if (Object.hasOwn(patch, OWNER_LOCK_KEY)) {
      throw this.invalid([
        {
          path: OWNER_LOCK_KEY,
          code: "INVALID_KEY",
          message: "A settings key cannot be the empty string.",
        },
      ]);
    }

    // DEEP, because a shallow spread replaces a nested object wholesale. A
    // group holding both a normal field and a secret — the ordinary shape for
    // a provider's `clientId` and `clientSecret` — lost the secret whenever
    // only the normal field was patched, and the admin cannot resend what it
    // only ever received as `{ set: true }`.
    const merged = deepMergeSettings(decoded.values, patch);

    // A key this patch writes must not carry a secret nothing can read: it
    // would be re-encrypted as the marker text. The patch has to name the
    // secret again, which is exactly what the operator is being asked to do.
    const stillUnreadable = Object.keys(patch).flatMap(key =>
      unreadablePaths(merged[key], [key])
    );
    if (stillUnreadable.length > 0) {
      throw this.invalid(
        stillUnreadable.map(path => ({
          path: path.join("."),
          code: "UNREADABLE_SECRET",
          message:
            "This secret cannot be decrypted with the configured NEXTLY_SECRET. Enter it again to update this setting.",
        }))
      );
    }

    // Keys the patch does not write and that hold an unreadable secret are
    // not validated: there is nothing to check them against, and demanding a
    // value there refused every unrelated write until the operator had
    // re-entered a secret they may not even be looking at.
    const unvalidated = new Set(
      [...decoded.unreadableKeys].filter(key => !Object.hasOwn(patch, key))
    );
    const parsed = this.schemaWithout(unvalidated).safeParse(
      omitKeys(merged, unvalidated)
    );
    if (!parsed.success) {
      throw this.invalid(
        parsed.error.issues.map(issue => ({
          path: issue.path.join(".") || "settings",
          code: issue.code.toUpperCase(),
          message: issue.message,
        }))
      );
    }

    // A plain zod object STRIPS what it does not know, at every depth, so a
    // misspelled field parsed happily and its value was silently dropped —
    // and at the top level `JSON.stringify(undefined)` then reached a NOT NULL
    // column. Refusing names the problem instead.
    const unknown = unknownPatchPaths(patch, parsed.data);
    if (unknown.length > 0) {
      throw this.invalid(
        unknown.map(path => ({
          path,
          code: "UNKNOWN_KEY",
          message: `"${path}" is not declared by this plugin's settings schema.`,
        }))
      );
    }

    // The PATCH's keys, not the parsed result's. Parsing fills in every
    // schema default, so writing those would turn a change of one field into
    // a reset of the others — a `port` update silently overwriting a stored
    // `clientSecret` with the empty default. A key the patch removed is
    // deleted, even when the schema refills it with a default: storing that
    // default would record it as a value someone saved, so a later change of
    // the plugin's default would not apply, and a defaulted secret would read
    // as set.
    const rows = Object.keys(patch).map(key =>
      patch[key] === null || !Object.hasOwn(parsed.data, key)
        ? this.removedRow(key, opts)
        : this.rowFor(key, parsed.data[key], opts, decoded.sealedPaths.get(key))
    );
    // Compared on the DECODED values: the stored text of a secret changes on
    // every write, since each seal draws a fresh IV, so comparing rows would
    // report every resent secret as changed.
    const changedKeys = rows
      .filter(row =>
        row.remove
          ? Object.hasOwn(decoded.values, row.key)
          : !isDeepStrictEqual(decoded.values[row.key], parsed.data[row.key])
      )
      .map(row => row.key);
    return { rows, changedKeys };
  }

  /** A validation refusal for this plugin's settings. */
  private invalid(
    errors: Array<{ path: string; code: string; message: string }>
  ): NextlyError {
    return NextlyError.validation({
      errors,
      logContext: { plugin: this.deps.owner },
    });
  }

  /** The row an update deletes. */
  private removedRow(
    key: string,
    opts?: { actorUserId?: string }
  ): PluginSettingRow {
    return {
      owner: this.deps.owner,
      key,
      value: "null",
      isSecret: false,
      updatedAt: new Date(),
      updatedBy: opts?.actorUserId ?? null,
      remove: true,
    };
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
    opts?: { actorUserId?: string },
    /**
     * Leaves that were stored encrypted, by full path. They are sealed again
     * wherever they still hold a value, even when the current manifest no
     * longer declares their path: a rewrite — a rotation's re-seal, a write
     * of a sibling — must never store a credential as plaintext.
     */
    sealedPaths: readonly string[][] = []
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
    const holdsSecret =
      topLevelKeyHoldsSecret(key, this.deps.secretPaths) ||
      sealedPaths.length > 0;
    const stored = JSON.stringify(
      holdsSecret
        ? this.sealLeaves(
            this.encryptSecrets(escapeEnvelopeClaimants(value), [key]),
            key,
            sealedPaths
          )
        : value
    );
    // One bound for all three dialects. MySQL's column holds 16 MB and the
    // others are unbounded, so without it a value saved fine on one install
    // and failed — or was truncated — on another.
    if (Buffer.byteLength(stored, "utf8") > MAX_SETTING_BYTES) {
      throw this.invalid([
        {
          path: key,
          code: "TOO_LARGE",
          message: `The "${key}" setting is larger than the ${MAX_SETTING_BYTES / 1024} KiB a setting may hold.`,
        },
      ]);
    }
    return {
      owner: this.deps.owner,
      key,
      value: stored,
      isSecret: holdsSecret,
      updatedAt: new Date(),
      updatedBy: opts?.actorUserId ?? null,
    };
  }

  /** The refusal for a settings value that cannot live in a settings row. */
  private unstorableValue(key: string, why: string): NextlyError {
    return this.invalid([
      {
        path: key,
        code: "NOT_STORABLE",
        message: `The "${key}" setting cannot be stored: ${why}. Store it as a JSON-native value (an ISO string rather than a date, for example) instead.`,
      },
    ]);
  }

  /**
   * The stored settings, decoded, after any repair a read owes them.
   *
   * Two repairs, both through the store's serialized mutation so they race
   * no one: a key the current manifest calls secret but that was stored while
   * public is encrypted, and a secret opened with a retired generation is
   * re-sealed under the current one. A failed repair does not fail the read —
   * the value is already in hand — but it is said out loud every time, since
   * each leaves a row in a state the manifest or the rotation says it is not.
   */
  private async readStored(): Promise<DecodedSettings> {
    const rows = await this.deps.store.read(this.deps.owner);
    const decoded = this.decodeRows(rows);
    const needsRepair = rows.some(
      row =>
        row.key !== OWNER_LOCK_KEY &&
        !decoded.unreadableKeys.has(row.key) &&
        (decoded.staleKeys.has(row.key) ||
          (!row.isSecret &&
            topLevelKeyHoldsSecret(row.key, this.deps.secretPaths)))
    );
    if (needsRepair) {
      await this.deps.store
        .mutate(
          this.deps.owner,
          [],
          stored => this.rowsForUpdate(stored, {}, undefined).rows
        )
        .catch((error: unknown) => {
          getNextlyLogger().warn({
            kind: "plugin-settings-secret-repair-failed",
            plugin: this.deps.owner,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }
    return decoded;
  }

  /**
   * Stored rows as a settings object.
   *
   * Split from `readStored` so the write path can decode the rows the
   * TRANSACTION read, rather than issuing a second read of its own — which is
   * the read whose staleness this whole path exists to avoid.
   */
  private decodeRows(rows: PluginSettingRow[]): DecodedSettings {
    const decoded: DecodedSettings = {
      values: {},
      unreadableKeys: new Set(),
      unreadableReasons: new Map(),
      staleKeys: new Set(),
      sealedPaths: new Map(),
    };
    for (const row of rows) {
      // The store's lock row is not settings. It is deleted before that
      // transaction commits, so a read should never meet one — skipping it
      // costs nothing and means a read taken mid-write could not decode a
      // placeholder as a plugin's stored value.
      if (row.key === OWNER_LOCK_KEY) continue;
      const parsed: unknown = JSON.parse(row.value);
      // Decoded by ENVELOPE, not by the current manifest's paths: a plugin
      // update can remove or rename a secret path, and a path-driven decode
      // then left the old encrypted leaf as its literal `enc:...` text. The
      // envelope is self-describing, so every encrypted leaf in a row stored
      // as secret is opened whatever the manifest now calls secret; where it
      // is RE-encrypted is a write-time decision, made against the paths the
      // current manifest declares.
      decoded.values[row.key] = row.isSecret
        ? this.decryptEnvelopes(parsed, [row.key], row.key, decoded)
        : parsed;
    }
    return decoded;
  }

  /**
   * Open every encrypted leaf in a stored secret row, wherever it sits.
   *
   * Only the envelope markers can say what a past manifest encrypted, so the
   * walk opens every `enc:` leaf it meets. Plaintext leaves pass through
   * untouched, which is what lets a row written before a path became secret
   * coexist with encrypted ones written after. Plaintext that merely begins
   * with the prefix cannot reach here: writes escape it.
   *
   * A leaf no configured generation can open becomes `UNREADABLE` and its
   * key is recorded, rather than failing the whole read: that is a credential
   * encrypted under a key the install no longer configures, and the operator
   * has to be able to see it and replace it.
   */
  private decryptEnvelopes(
    value: unknown,
    path: string[],
    key: string,
    decoded: DecodedSettings
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item, i) =>
        this.decryptEnvelopes(item, [...path, String(i)], key, decoded)
      );
    }
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [name, item] of Object.entries(value)) {
        out[name] = this.decryptEnvelopes(item, [...path, name], key, decoded);
      }
      return out;
    }
    return typeof value === "string"
      ? this.openLeaf(value, path, key, decoded)
      : value;
  }

  /**
   * One string leaf of a stored secret row: an escaped plaintext loses its
   * escape, an envelope is opened, and anything else is plaintext as stored.
   */
  private openLeaf(
    value: string,
    path: string[],
    key: string,
    decoded: DecodedSettings
  ): unknown {
    if (value.startsWith(ESCAPE_PREFIX)) {
      return value.slice(ESCAPE_PREFIX.length);
    }
    if (!value.startsWith(SECRET_ENVELOPE)) return value;
    const sealed = decoded.sealedPaths.get(key) ?? [];
    sealed.push(path);
    decoded.sealedPaths.set(key, sealed);
    const opened = openSetting(
      value.slice(SECRET_ENVELOPE.length),
      this.deps.secrets(),
      this.deps.owner,
      path
    );
    if (!opened.readable) {
      decoded.unreadableKeys.add(key);
      decoded.unreadableReasons.set(path.join("."), opened.reason);
      return UNREADABLE;
    }
    if (opened.stale) decoded.staleKeys.add(key);
    return unescapeClaim(opened.plaintext);
  }

  /**
   * Seal each previously encrypted leaf that is still plaintext in `value`.
   *
   * `value` is the key's value with its declared secrets already sealed, so a
   * leaf the manifest still declares is an envelope by now and is left alone.
   */
  private sealLeaves(
    value: unknown,
    key: string,
    sealedPaths: readonly string[][]
  ): unknown {
    let out = value;
    for (const path of sealedPaths) {
      out = replaceAt(out, path.slice(1), leaf =>
        typeof leaf === "string" && !leaf.startsWith(SECRET_ENVELOPE)
          ? this.sealOne(leaf, path)
          : leaf
      );
    }
    return out;
  }

  /** One secret, sealed under the current generation at `path`. */
  private sealOne(secret: string, path: string[]): string {
    const [current] = this.deps.secrets();
    if (!current) {
      throw NextlyError.internal({
        logContext: {
          reason: "no secret configured for plugin settings encryption",
          plugin: this.deps.owner,
        },
      });
    }
    return `${SECRET_ENVELOPE}${sealSetting(secret, current, this.deps.owner, path)}`;
  }

  private encryptSecrets(value: unknown, path: string[]): unknown {
    return mapSecrets(
      value,
      this.deps.secretPaths,
      (secret, at) => {
        if (secret === undefined || secret === null) return secret;
        // A secret is a credential, which is a string. Anything else is a
        // schema mistake, and stringifying an object would store
        // "[object Object]" as though it were the credential.
        if (typeof secret !== "string") {
          throw this.invalid([
            {
              path: at.join("."),
              code: "INVALID",
              message: "A secret setting must be a string.",
            },
          ]);
        }
        // Bound to this plugin and this path, so a value copied to another
        // row or another location does not decrypt as that setting.
        return this.sealOne(secret, at);
      },
      path
    );
  }
}

/** Copy into `target` every member of `source` that `target` lacks, at any depth. */
function fillAbsent(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (existing === undefined) target[key] = value;
    else if (isPlainObject(existing) && isPlainObject(value)) {
      fillAbsent(existing, value);
    }
  }
}

/** `value` without the named keys. */
function omitKeys(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>
): Record<string, unknown> {
  if (keys.size === 0) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.has(key))
  );
}

/**
 * The admin view of a key holding a secret nothing can decrypt.
 *
 * Every declared secret is redacted as usual, and an unreadable one — at a
 * declared path or at one a newer manifest no longer declares — is reported
 * `{ set: true, readable: false }`: it is stored, and it has to be entered
 * again.
 */
function redactUnreadable(
  value: unknown,
  path: string[],
  secretPaths: readonly string[]
): unknown {
  const unreadableView = { set: true, readable: false };
  const redacted = mapSecrets(
    value,
    secretPaths,
    secret =>
      secret === UNREADABLE ? unreadableView : { set: hasSecretValue(secret) },
    path
  );
  const replaceStray = (node: unknown): unknown => {
    if (node === UNREADABLE) return unreadableView;
    if (Array.isArray(node)) return node.map(replaceStray);
    if (isPlainObject(node)) {
      return Object.fromEntries(
        Object.entries(node).map(([key, item]) => [key, replaceStray(item)])
      );
    }
    return node;
  };
  return replaceStray(redacted);
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
 * Strip the escape marker a claim gained on its way into an envelope.
 *
 * The escape walk runs over the WHOLE row value before encryption, so a
 * declared secret whose own text begins with a marker is escaped and then
 * encrypted — the marker would otherwise come back out with the decrypted
 * credential, changing it. Stripping here is the symmetric half of the
 * round trip: escape before encrypt, unescape after decrypt, and a value
 * beginning with the marker keeps exactly one (the doubling preserves it).
 */
function unescapeClaim(opened: unknown): unknown {
  return typeof opened === "string" && opened.startsWith(ESCAPE_PREFIX)
    ? opened.slice(ESCAPE_PREFIX.length)
    : opened;
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

/** The members of `value` whose keys `shape` declares. */
function pickKeys(
  value: Record<string, unknown>,
  shape: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => Object.hasOwn(shape, key))
  );
}

/**
 * `node` with the leaf at `path` replaced by `replace(leaf)`, copying the
 * containers on the way down. A path that does not exist leaves `node` as it
 * is.
 */
function replaceAt(
  node: unknown,
  path: readonly string[],
  replace: (leaf: unknown) => unknown
): unknown {
  if (path.length === 0) return replace(node);
  const [head, ...rest] = path;
  if (Array.isArray(node)) {
    const index = Number(head);
    if (!Number.isInteger(index) || index < 0 || index >= node.length) {
      return node;
    }
    const copy = [...node];
    copy[index] = replaceAt(node[index], rest, replace);
    return copy;
  }
  if (!isPlainObject(node) || !Object.hasOwn(node, head)) return node;
  return { ...node, [head]: replaceAt(node[head], rest, replace) };
}

/**
 * Redact, in place, every leaf of the view that was stored encrypted and is
 * still a value rather than a `{ set }` marker.
 */
function redactSealedLeaves(
  view: Record<string, unknown>,
  sealedPaths: ReadonlyMap<string, string[][]>
): void {
  for (const [key, paths] of sealedPaths) {
    if (!Object.hasOwn(view, key)) continue;
    for (const path of paths) {
      view[key] = replaceAt(view[key], path.slice(1), leaf =>
        typeof leaf === "string" ? { set: true } : leaf
      );
    }
  }
}
