/**
 * The keys a collection read sorts by, read once from what the caller sent.
 *
 * The guard that refuses a sort on a field the caller may not read and the
 * ORDER BY that sorts both take their keys from {@link parseSortKeys}, so the
 * guard judges exactly the keys that are sorted. Two readers of one string
 * drift: one splitting on commas and the other not would let a refused field
 * ride in second position.
 *
 * @module domains/collections/query/sort-keys
 */
import { asc, desc, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";

/** One key of a sort, in the order it was given. */
export interface SortKey {
  /** The field as the caller wrote it, without the leading `-`. */
  field: string;
  /** `-field` sorts descending. */
  desc: boolean;
}

/**
 * Read a sort given as one string, a comma-separated string, or an array of
 * either, into its keys in order.
 *
 * Whitespace around a key is dropped and so is an empty key, so a trailing
 * comma names nothing. A field named twice keeps its first position and
 * direction: a later key on it could never change the order, since every tie
 * it could break has already been broken.
 */
export function parseSortKeys(
  sort: string | readonly string[] | undefined
): SortKey[] {
  if (sort === undefined) return [];
  const written = (typeof sort === "string" ? [sort] : sort).flatMap(item =>
    item.split(",")
  );
  const keys: SortKey[] = [];
  const seen = new Set<string>();
  for (const raw of written) {
    const trimmed = raw.trim();
    const desc = trimmed.startsWith("-");
    const field = (desc ? trimmed.slice(1) : trimmed).trim();
    if (field === "" || seen.has(field)) continue;
    seen.add(field);
    keys.push({ field, desc });
  }
  return keys;
}

/**
 * Whether the caller sorted by the id themselves, so the id tiebreak the read
 * adds last would repeat it.
 */
export function sortsById(keys: readonly SortKey[]): boolean {
  return keys.some(key => key.field === "id");
}

/**
 * Refuse an offset that names no position, or one given together with a page.
 *
 * An offset is a whole number from zero. A page and an offset each say where
 * the read starts, and two answers to one question have no right one to pick.
 */
export function assertReadOffset(
  offset: number | undefined,
  page: number | undefined
): void {
  if (offset === undefined) return;
  if (!Number.isInteger(offset) || offset < 0) {
    throw NextlyError.invalidInput({
      message: "offset must be a whole number from 0.",
      logContext: { reason: "read-offset-not-whole", offset },
    });
  }
  if (page !== undefined) {
    throw NextlyError.invalidInput({
      message: "Give an offset or a page, not both.",
      logContext: { reason: "read-offset-with-page", offset, page },
    });
  }
}

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
