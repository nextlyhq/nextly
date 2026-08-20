/**
 * Normalizes the per-collection / per-single `versions` option into one
 * canonical `ResolvedVersionsConfig` (or `null` when unversioned). Every
 * versioning consumer reads the resolved shape, never the raw option, so the
 * defaulting rules live in exactly one place. Pure and total: it never throws,
 * falling back to defaults for malformed input (mirrors
 * `services/upload-validation/resolve-config.ts`).
 *
 * @module domains/versions/resolve-config
 */

import type {
  ResolvedVersionsConfig,
  VersionsConfig,
} from "../../schemas/versions/types";

/** Default autosave debounce when autosave is enabled. */
export const DEFAULT_AUTOSAVE_INTERVAL_MS = 1000;

/** Default number of durable versions retained per document. */
export const DEFAULT_MAX_PER_DOC = 50;

/**
 * Resolve the effective versioning config for an entity.
 *
 * @param versions - the entity's `versions` option (`boolean | VersionsConfig`)
 * @param status - the draft/publish lifecycle flag. `status: true` alone
 *   enables history-only versioning (every write is a restorable version) but
 *   NOT the working-draft split: editing a published document in place stays the
 *   default. The split is opt-in via an explicit `versions: { drafts: true }`.
 *   An explicit `versions` option always wins over `status`.
 * @returns the canonical resolved config, or `null` when the entity is
 *   unversioned.
 */
export function resolveVersionsConfig(
  versions: boolean | VersionsConfig | undefined,
  status?: boolean
): ResolvedVersionsConfig | null {
  // `status: true` alone enables the draft/publish lifecycle and history-only
  // versioning, but NOT the working-draft split — editing a published document
  // in place stays the default. The split (non-destructive edits to a published
  // document) is opt-in via an explicit `versions: { drafts: true }`, or
  // `versions: true` where drafts default on. An explicit `versions` option
  // always takes precedence over this lifecycle flag.
  const effective: boolean | VersionsConfig | undefined =
    versions !== undefined
      ? versions
      : status === true
        ? { drafts: false }
        : undefined;

  // `null`/`false`/absent all mean unversioned. A falsy check (untyped JS could
  // pass `versions: null`) keeps the object branch below from dereferencing null.
  if (!effective) {
    return null;
  }

  const config: VersionsConfig = effective === true ? {} : effective;

  // Drafts default ON when versioning is enabled; only an explicit `drafts:
  // false` selects history-only mode.
  const draftsRaw = config.drafts;
  const draftsEnabled = draftsRaw !== false;

  // Autosave only applies when drafts are on. It defaults ON, unless drafts is
  // an object that explicitly disables it.
  let autosaveEnabled = draftsEnabled;
  let autosaveIntervalMs = DEFAULT_AUTOSAVE_INTERVAL_MS;

  // `typeof null === "object"`, so guard against null before dereferencing:
  // options may arrive from untyped JS config or a Schema-Builder payload where
  // `drafts: null` / `autosave: null` is possible, and must fall back to
  // defaults rather than throw during boot.
  if (draftsEnabled && typeof draftsRaw === "object" && draftsRaw !== null) {
    const autosaveRaw = draftsRaw.autosave;
    if (autosaveRaw === false) {
      autosaveEnabled = false;
    } else if (typeof autosaveRaw === "object" && autosaveRaw !== null) {
      autosaveEnabled = true;
      if (typeof autosaveRaw.intervalMs === "number") {
        autosaveIntervalMs = autosaveRaw.intervalMs;
      }
    }
  }

  // `maxPerDoc: false` means unlimited; otherwise a positive number, defaulting
  // to DEFAULT_MAX_PER_DOC.
  const maxPerDoc: number | false =
    config.maxPerDoc === false
      ? false
      : typeof config.maxPerDoc === "number"
        ? config.maxPerDoc
        : DEFAULT_MAX_PER_DOC;

  return {
    enabled: true,
    drafts: {
      enabled: draftsEnabled,
      autosave: {
        enabled: draftsEnabled && autosaveEnabled,
        intervalMs: autosaveIntervalMs,
      },
    },
    maxPerDoc,
  };
}
