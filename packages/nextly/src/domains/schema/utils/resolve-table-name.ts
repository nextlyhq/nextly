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

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
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

// A component's physical table is always derived from its slug. Custom names
// are not accepted: they can only be validated against storage Nextly knows
// about, which leaves the host application's own tables claimable, and the
// identifier-case rules that decide whether two spellings are one table are
// server configuration rather than anything the config can state.
export function resolveComponentTableName(slug: string): string {
  return `${STORAGE_FORMAT.tablePrefix}${normalizeIdentifier(slug)}`;
}
