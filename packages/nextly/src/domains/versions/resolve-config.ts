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
 * @param status - the legacy `status` flag; `status: true` alone is a
 *   deprecated alias for `versions: { drafts: true }`. An explicit `versions`
 *   option always wins over `status`.
 * @returns the canonical resolved config, or `null` when the entity is
 *   unversioned.
 */
export function resolveVersionsConfig(
  versions: boolean | VersionsConfig | undefined,
  status?: boolean
): ResolvedVersionsConfig | null {
  // `status: true` (alone) aliases to `versions: { drafts: true }`; an explicit
  // `versions` option takes precedence over the legacy flag.
  const effective: boolean | VersionsConfig | undefined =
    versions !== undefined
      ? versions
      : status === true
        ? { drafts: true }
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
  let schedulePublish = false;

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
    schedulePublish = draftsRaw.schedulePublish === true;
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
      schedulePublish,
    },
    maxPerDoc,
  };
}
