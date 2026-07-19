// Identifies which tables Nextly manages. Used as the tablesFilter
// argument to drizzle-kit's pushSchema so we never touch user tables
// or non-managed nextly_* tables.
//
// Adding a prefix here is a SemVer change — downstream tools may
// rely on this prefix list. Coordinate with plugin field types
// (Gap 8 in the finalized plan) when extending.

export const MANAGED_TABLE_PREFIXES_REGEX = /^(dc_|single_|comp_)/;

export function isManagedTable(name: string): boolean {
  return MANAGED_TABLE_PREFIXES_REGEX.test(name);
}

// Localized companion tables (`dc_<slug>_locales` / `single_<slug>_locales` /
// `comp_<slug>_locales`) are owned by the localization migration layer (M1) — created/dropped
// only by generated migrations (or the in-process companion reconcile on the UI apply path).
// They match the managed prefix above, so the diff/pushSchema pipeline MUST additionally
// exclude them via `isCompanionTable`, or it would introspect/diff them against a desired state
// that never declares them and spuriously add/drop the table.
const COMPANION_TABLE_REGEX = /^(dc_|single_|comp_).+_locales$/;

export function isCompanionTable(name: string): boolean {
  return COMPANION_TABLE_REGEX.test(name);
}
