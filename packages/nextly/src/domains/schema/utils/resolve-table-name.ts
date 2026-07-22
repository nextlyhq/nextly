// Single source of truth for the dc_<slug> table-name convention used
// by user collections. F8 PR 6 review #3 found three sites computing
// this independently with subtle drift (dashes preserved in dbName
// vs replaced by underscores). Consolidated here so register.ts,
// dev-server.ts, and init.ts all produce identical names.
//
// Note: each entity kind normalizes differently at runtime — collections
// replace dashes in the slug only, while singles and components run the
// stronger `normalizeIdentifier`, and components alone keep a custom `dbName`
// unprefixed. The migration CLI must route each kind through its matching
// resolver (see resolveSingleTableName / resolveComponentTableName) rather than
// a single generic rule, or generated names diverge from the live database.

import { normalizeIdentifier } from "../../singles/services/resolve-single-table-name";

// Rule (mirrors the runtime collection sync in di/register.ts exactly):
//   - base = dbName, or the slug with dashes replaced by underscores.
//     A custom `dbName` is taken as written — dashes included — because the
//     runtime does not rewrite it either, and a resolver that "tidied" it
//     would make the CLI target `dc_my_table` while the app uses `dc_my-table`.
//   - If base already starts with `dc_`, use it verbatim (the user opted into
//     a custom physical name); otherwise prefix it.
export function resolveCollectionTableName(
  slug: string,
  dbName?: string
): string {
  const base = dbName ?? slug.replace(/-/g, "_");
  return base.startsWith("dc_") ? base : `dc_${base}`;
}

// Mirrors the runtime component table sync (di/register.ts): a custom `dbName`
// is honored verbatim, otherwise the slug is normalized (lowercased,
// non-alphanumeric runs collapsed to "_", edges trimmed) and `comp_`-prefixed.
// Components intentionally differ from collections/singles: a custom dbName is
// NOT force-prefixed. The CLI must mirror this or `migrate:create` would target
// a different table than the live app for a component with a custom dbName.
export function resolveComponentTableName(
  slug: string,
  dbName?: string
): string {
  return dbName ?? `comp_${normalizeIdentifier(slug)}`;
}
