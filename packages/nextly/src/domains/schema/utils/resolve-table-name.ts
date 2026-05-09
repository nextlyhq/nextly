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
  if (dbName && dbName.startsWith("dc_")) return dbName;
  const base = dbName ?? slug;
  return `dc_${base.replace(/-/g, "_")}`;
}
