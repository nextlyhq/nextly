/**
 * The ORDER BY of a collection read, built from the keys `parseSortKeys` read.
 *
 * Apart from `filter-shape`, which parses and judges the sort, because building
 * the clause needs the database layer and `filter-shape` must not: it is
 * reached from `nextly/config`, and from the admin's browser bundle through it.
 * Only the server's query service imports this module.
 *
 * @module domains/collections/query/sort-order
 */

import { asc, desc, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { sortsById, type SortKey } from "./filter-shape";

/** A sort key resolved against the collection: what to order by. */
export interface ResolvedSortKey {
  expr: SQLWrapper;
  /** Whether the value can be NULL, which decides the empty-last key. */
  nullable: boolean;
}

/**
 * The ORDER BY of a read, one entry per sort expression.
 *
 * Each key sorts in turn. A key whose value can be NULL is led by
 * `expr IS NULL`, which is false before true on every dialect, so empty values
 * come last whichever the direction; a NOT NULL key gets none, so an index on
 * it still serves the sort. `resolve` answers `undefined` for a key the read
 * drops, and the others still sort. When the read is `ordered` (it named a
 * sort, even an empty one, or an offset) the id breaks every tie left,
 * ascending, unless a key already names it. A read that is not ordered gets no
 * ORDER BY at all, as before.
 */
export function orderBySortKeys(params: {
  keys: readonly SortKey[];
  ordered: boolean;
  id: SQLWrapper;
  resolve: (field: string) => ResolvedSortKey | undefined;
}): SQL[] {
  const parts: SQL[] = [];
  for (const key of params.keys) {
    const resolved = params.resolve(key.field);
    if (!resolved) continue;
    if (resolved.nullable) parts.push(sql`${resolved.expr} is null`);
    parts.push(key.desc ? desc(resolved.expr) : asc(resolved.expr));
  }
  if (params.ordered && !sortsById(params.keys)) parts.push(asc(params.id));
  return parts;
}
