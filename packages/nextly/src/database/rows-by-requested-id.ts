/**
 * Rows read by id, handed back to the ids they were asked by. A read by `IN (...)` answers the
 * rows the database matched, each under its stored id; a caller asked by ids of its own. Where the
 * database compares ids exactly, an id names the row of that exact id. Where it compares them
 * without regard to case (MySQL, under its case-insensitive collation), an id also names the one
 * stored id that differs from it only in case, as the database matched it. Every read that asks by
 * ids and answers by them maps its rows back here, so two of them never disagree about which row an
 * id named.
 *
 * @module database/rows-by-requested-id
 */

/**
 * Whether the database compares ids without regard to case: MySQL does, under its case-insensitive
 * collation; PostgreSQL and SQLite compare them exactly.
 *
 * @experimental
 */
export function comparesIdsWithoutCase(dialect: string | undefined): boolean {
  return dialect === "mysql";
}

/**
 * Each of `requested` that names a stored id, mapped to that id's rows (an id may own several, as
 * a person owns several role assignments). The same row may come back more than once, as reads
 * split into several statements return it to each that matches it; it is still one stored id, so
 * it never makes another spelling ambiguous. Two stored ids that differ only in case leave a third
 * spelling of them naming neither.
 *
 * @experimental
 */
export function rowsByRequestedId<Row>(
  requested: readonly string[],
  rows: readonly Row[],
  idOf: (row: Row) => string,
  foldsCase: boolean
): Map<string, Row[]> {
  const exact = new Map<string, Row[]>();
  for (const row of rows) {
    const id = idOf(row);
    const own = exact.get(id);
    if (own) own.push(row);
    else exact.set(id, [row]);
  }
  // The one stored id each case-folded spelling names, or null where two stored ids share it.
  const folded = new Map<string, string | null>();
  if (foldsCase) {
    for (const id of exact.keys()) {
      const key = id.toLowerCase();
      folded.set(key, folded.has(key) ? null : id);
    }
  }
  const found = new Map<string, Row[]>();
  for (const id of new Set(requested)) {
    const stored = exact.has(id) ? id : folded.get(id.toLowerCase());
    const own = typeof stored === "string" ? exact.get(stored) : undefined;
    if (own) found.set(id, own);
  }
  return found;
}
