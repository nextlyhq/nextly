/**
 * Resolves a name Nextly stored to the name the database actually reports.
 *
 * Two callers need this and both get it wrong in a different direction if they
 * guess. Extracted here so there is one implementation rather than a copy per
 * call site, for the same reason `resolveCollectionTableName` was consolidated:
 * independent versions of a naming rule drift, and the drift is invisible until
 * it reaches a database that exercises the difference.
 *
 * @module domains/schema/utils/resolve-catalog-name
 */

/**
 * A catalog listing, prepared once for repeated lookups.
 *
 * Built from `adapter.listTables()`. Holding both an exact set and a folded
 * index is what lets a lookup prefer an exact hit and still find a
 * case-different one.
 */
export interface CatalogIndex {
  /** Names exactly as the database reported them. */
  readonly exact: ReadonlySet<string>;
  /** Lower-cased name to the first catalog entry that folded to it. */
  readonly folded: ReadonlyMap<string, string>;
}

/** Index a catalog listing for lookup. */
export function indexCatalog(tables: readonly string[]): CatalogIndex {
  const exact = new Set(tables);
  const folded = new Map<string, string>();
  for (const name of tables) {
    const key = name.toLowerCase();
    // First writer wins, so an ambiguous fold cannot silently retarget a table:
    // if a database holds both `SEO_META` and `seo_meta`, a folded lookup keeps
    // pointing at whichever the catalog listed first rather than alternating.
    if (!folded.has(key)) folded.set(key, name);
  }
  return { exact, folded };
}

/**
 * Resolve a stored name to the catalog's spelling of it, or `undefined`.
 *
 * Exact match first, then case-insensitive. Both halves are necessary and
 * neither is sufficient:
 *
 * - MySQL with `lower_case_table_names` reports a verbatim `SEO_META` as
 *   `seo_meta`, so an exact-only lookup discards a table that genuinely exists.
 * - Postgres, and MySQL with `lower_case_table_names=0`, hold `SEO_META` and
 *   `seo_meta` as distinct quoted tables, so folding unconditionally collapses
 *   two tables into one and lets an operation touch the wrong one.
 *
 * Preferring the exact hit keeps those distinct while the fallback still finds a
 * folded entry. The value returned is always the name the catalog reported,
 * because that is the spelling later statements have to address — not the
 * spelling Nextly happened to store.
 */
export function resolveCatalogName(
  catalog: CatalogIndex,
  storedName: string
): string | undefined {
  if (catalog.exact.has(storedName)) return storedName;
  return catalog.folded.get(storedName.toLowerCase());
}
