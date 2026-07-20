// Single source of truth for the dc_<slug> table-name convention used
// by user collections. F8 PR 6 review #3 found three sites computing
// this independently with subtle drift (dashes preserved in dbName
// vs replaced by underscores). Consolidated here so register.ts,
// dev-server.ts, and init.ts all produce identical names.
//
// Note: each entity kind normalizes differently at runtime — collections
// replace only dashes here, while singles and components run the stronger
// `normalizeIdentifier`. The migration CLI must route each kind through its
// matching resolver (see resolveSingleTableName / resolveComponentTableName)
// rather than a single generic rule, or generated names diverge from the DB.

import { normalizeIdentifier } from "../../singles/services/resolve-single-table-name";

// Rule:
//   - If `dbName` is provided AND already starts with `dc_`, use it
//     verbatim. (User explicitly opted into a custom physical name.)
//   - Otherwise, base = (dbName ?? slug), normalize dashes -> underscores,
//     and prefix with `dc_`.
export function resolveCollectionTableName(
  slug: string,
  dbName?: string
): string {
  if (dbName && dbName.startsWith("dc_")) return dbName;
  const base = dbName ?? slug;
  return `dc_${base.replace(/-/g, "_")}`;
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
