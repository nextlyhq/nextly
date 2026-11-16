// Clearing a lossy column's values: exactly the rows the run's judgement named, by their key.
//
// A lossy conversion clears each value the new type cannot hold, setting it to null. Which rows
// those are is the judgement's answer, read from the same pass over the column that classed it
// (`judgeColumn`'s `noteRow`), so the rows cleared and the rows reported cannot disagree. Rows are
// named by their table's full key: an entity's own table by its id, a translation table by its
// parent and locale. A clearing never names a row by its value, and never clears a row by a
// predicate alone, so a value written after the judgement is not cleared under a consent given
// for the rows the judgement named.
//
// @module domains/schema/repair-columns/clearing

import { sql, type SQL } from "drizzle-orm";

import { COMPANION_KEY_COLUMNS } from "../../i18n/companion-columns";
import type { KeyedBy } from "../value-conversion/read-values";
import type { RowKey } from "../value-conversion/types";

/** How many keys one clearing statement names, so no statement grows past a driver's limits. */
const KEYS_PER_STATEMENT = 500;

/** A key as one string, for telling two judgements' rows apart. */
export function rowKeyText(key: RowKey): string {
  return "id" in key ? `id:${key.id}` : `row:${key.parent}\u0000${key.locale}`;
}

/** The condition that holds for exactly the rows `keys` name. */
function keysCondition(keys: readonly RowKey[], keyedBy: KeyedBy): SQL {
  if (keyedBy === "id") {
    const ids = keys.map(key => ("id" in key ? key.id : ""));
    return sql`${sql.identifier("id")} IN (${sql.join(
      ids.map(id => sql`${id}`),
      sql`, `
    )})`;
  }
  const [parent, locale] = COMPANION_KEY_COLUMNS;
  return sql.join(
    keys.map(key =>
      "parent" in key
        ? sql`(${sql.identifier(parent)} = ${key.parent} AND ${sql.identifier(locale)} = ${key.locale})`
        : sql`FALSE`
    ),
    sql` OR `
  );
}

/** `keys` in groups of at most {@link KEYS_PER_STATEMENT}. */
function batches(keys: readonly RowKey[]): RowKey[][] {
  const groups: RowKey[][] = [];
  for (let start = 0; start < keys.length; start += KEYS_PER_STATEMENT) {
    groups.push(keys.slice(start, start + KEYS_PER_STATEMENT));
  }
  return groups;
}

/**
 * The statements that set `column` to null in exactly the rows `keys` name. Only a table keyed by
 * its id or by its parent and locale names its rows; anything else has no clearing.
 */
export function clearingStatements(args: {
  table: string;
  column: string;
  keyedBy: KeyedBy;
  keys: readonly RowKey[];
}): SQL[] {
  if (args.keyedBy === "none") return [];
  return batches(args.keys).map(
    group =>
      sql`UPDATE ${sql.identifier(args.table)} SET ${sql.identifier(args.column)} = NULL WHERE ${keysCondition(group, args.keyedBy)}`
  );
}

/**
 * MySQL: the queries that read, and lock until the transaction ends, which of the rows `keys` name
 * still hold a value MySQL does not read as JSON. A row whose value was corrected since the
 * judgement is not cleared; a row the judgement did not name is not read at all. Each row's key is
 * read back with `rowKeyOf`, as the judgement read it.
 */
export function stillNotJsonQueries(args: {
  table: string;
  column: string;
  keyedBy: KeyedBy;
  keys: readonly RowKey[];
}): SQL[] {
  if (args.keyedBy === "none") return [];
  const keyColumns =
    args.keyedBy === "id" ? ["id"] : [...COMPANION_KEY_COLUMNS];
  const selected = sql.join(
    keyColumns.map(
      (name, i) =>
        sql`CAST(${sql.identifier(name)} AS CHAR) AS ${sql.raw(`k${i + 1}`)}`
    ),
    sql`, `
  );
  return batches(args.keys).map(
    group =>
      sql`SELECT ${selected} FROM ${sql.identifier(args.table)} WHERE (${keysCondition(group, args.keyedBy)}) AND ${notJsonCondition(args.column)} FOR UPDATE`
  );
}

/**
 * The rows of `column` holding a value MySQL does not read as JSON: the one condition for both
 * which named rows a clearing still clears and whether a stopped clearing has anything left, so
 * the two can never disagree about a value.
 */
export function notJsonCondition(column: string): SQL {
  const value = sql.identifier(column);
  return sql`${value} IS NOT NULL AND NOT JSON_VALID(${value})`;
}
