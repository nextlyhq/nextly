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
  const byStoredId = groupedByStoredId(rows, idOf);
  const folded = foldsCase
    ? storedIdsByFoldedCase(byStoredId.keys())
    : new Map<string, string | null>();
  const found = new Map<string, Row[]>();
  for (const id of new Set(requested)) {
    const stored = storedIdNamed(id, byStoredId, folded);
    const own = stored === undefined ? undefined : byStoredId.get(stored);
    if (own) found.set(id, own);
  }
  return found;
}

/** `rows` by their stored id, a row returned more than once kept under its one id. */
function groupedByStoredId<Row>(
  rows: readonly Row[],
  idOf: (row: Row) => string
): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const id = idOf(row);
    const own = grouped.get(id);
    if (own) own.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

/** The one stored id each case-folded spelling names, or null where two stored ids share it. */
function storedIdsByFoldedCase(
  storedIds: Iterable<string>
): Map<string, string | null> {
  const folded = new Map<string, string | null>();
  for (const id of storedIds) {
    const key = id.toLowerCase();
    folded.set(key, folded.has(key) ? null : id);
  }
  return folded;
}

/** The stored id `id` names: itself where stored, else the one stored id of its folded case. */
function storedIdNamed(
  id: string,
  byStoredId: ReadonlyMap<string, unknown>,
  folded: ReadonlyMap<string, string | null>
): string | undefined {
  if (byStoredId.has(id)) return id;
  return folded.get(id.toLowerCase()) ?? undefined;
}
