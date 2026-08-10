// What an index on one column is called.
//
// Two places have to agree on this: the DDL that creates the index, and the desired schema the
// live-versus-desired diff compares a table against. When they disagreed, every diff reported the
// installed index as unexpected and the declared one as missing, so a reconcile replaced an index
// with an identical index for as long as anyone kept running it.
//
// The bound is 63 characters, which is the smaller of the two limits that matter and therefore
// the only safe one. MySQL REFUSES an identifier over 64. PostgreSQL accepts one and silently
// TRUNCATES it to 63, so at 64 two names differing only in their last character arrive as a
// single identifier — a collision no error reports. A collection name and a field name may each
// be 50 characters, so the composed name reaches 105 and the bound is genuinely reachable.

/**
 * The index name for one column of one table, bounded so every dialect stores it whole.
 *
 * A name within the bound is returned unchanged, which keeps the common case readable and keeps
 * every index created before the bound existed addressable by its own name. A longer one keeps as
 * much of the readable prefix as fits and ends in a hash of the WHOLE name, so two long names
 * sharing a prefix stay distinct.
 */
export function indexNameForColumn(tableName: string, column: string): string {
  const full = `idx_${tableName}_${column}`;
  if (full.length <= MAX_INDEX_NAME_LENGTH) return full;

  // FNV-1a. Not for secrecy — only to tell apart two names a plain truncation would merge.
  let hash = 0x811c9dc5;
  for (let i = 0; i < full.length; i++) {
    hash ^= full.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const suffix = hash.toString(36).padStart(7, "0");
  return `${full.slice(0, MAX_INDEX_NAME_LENGTH - suffix.length - 1)}_${suffix}`;
}

/** PostgreSQL truncates at this length; MySQL refuses one character beyond it. */
export const MAX_INDEX_NAME_LENGTH = 63;

/**
 * The name of the UNIQUE index on a column.
 *
 * Derived from `indexNameForColumn` rather than composed, so it inherits the length bound and the
 * disambiguating hash. Composing `uq_${table}_${column}` directly looks equivalent and is not: for
 * names near their limits it exceeds 63 characters, which MySQL refuses outright and PostgreSQL
 * truncates — leaving the created index under a name that disagrees with the one the desired schema
 * declares, which is the disagreement this naming exists to prevent.
 */
export function uniqueIndexNameForColumn(
  tableName: string,
  column: string
): string {
  return indexNameForColumn(tableName, column).replace(/^idx_/, "uq_");
}

/**
 * Whether the dialect can index a column of this type at all.
 *
 * MySQL cannot index a JSON column: it answers that indexing is supported "only via generated
 * columns on a specified JSON path". PostgreSQL and SQLite index the value, so the same field
 * means the same thing everywhere it can.
 *
 * Asked by BOTH the statements that create indexes and the desired schema the diff compares a
 * table against. When only the statements knew, the desired schema went on declaring an index the
 * generator deliberately never wrote, and every reconcile emitted a `CREATE INDEX` on a JSON
 * column that MySQL rejects — the same failure, once per attempt, indefinitely.
 */
export function columnTypeIsIndexable(
  columnType: string,
  dialect: string
): boolean {
  if (dialect !== "mysql") return true;
  return !/\bjson\b/i.test(columnType);
}
