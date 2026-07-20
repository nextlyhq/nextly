// Single source of truth for the dc_<slug> table-name convention used
// by user collections. F8 PR 6 review #3 found three sites computing
// this independently with subtle drift (dashes preserved in dbName
// vs replaced by underscores). Consolidated here so register.ts,
// dev-server.ts, and init.ts all produce identical names.
//
// Rule:
//   - If `dbName` is provided AND already starts with `dc_`, use it
//     verbatim. (User explicitly opted into a custom physical name.)
//   - Otherwise, base = (dbName ?? slug), normalize dashes -> underscores,
//     and prefix with `dc_`.

export function resolveCollectionTableName(
  slug: string,
  dbName?: string
): string {
  return resolvePrefixedTableName(slug, dbName, "dc_");
}

// Generalizes the rule above to the `single_` and `comp_` prefixes as well,
// for the migration CLI which resolves all three entity kinds through a
// shared prefix. A `dbName` that already carries the target prefix is used
// verbatim; otherwise the `dbName ?? slug` base has its dashes normalized to
// underscores and is prefixed. This keeps a plugin entity whose `dbName`
// omits the prefix (e.g. a collection with `dbName: "forms"`) from producing
// an un-prefixed table that diverges from the runtime's `dc_forms`.
export function resolvePrefixedTableName(
  slug: string,
  dbName: string | undefined,
  prefix: "dc_" | "single_" | "comp_"
): string {
  if (dbName && dbName.startsWith(prefix)) return dbName;
  const base = dbName ?? slug;
  return `${prefix}${base.replace(/-/g, "_")}`;
}
