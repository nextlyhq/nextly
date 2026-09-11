/**
 * The transactional UPDATE, assembled by the adapter rather than by the
 * Drizzle query builder.
 *
 * `db.update(table).set(row)` builds its SET clause by walking the table's
 * DECLARED columns and probing `row` for each — never the other way round —
 * so a key naming a column the runtime model does not declare is dropped
 * without a word. One place relies on writing exactly such a column: the
 * localization transition window. `localized` has been flipped on a
 * collection, the runtime model has moved its translatable columns to a
 * companion table that does not exist yet, and the physical main table still
 * holds them. The default locale keeps writing there until the companion
 * appears, and the transactional INSERT already reaches it because every
 * adapter builds that statement itself. This is the UPDATE half of the same
 * rule, shared by the three adapters so the statement is spelled once.
 *
 * Built on Drizzle's `sql` template rather than a string, so each dialect
 * quotes identifiers and numbers placeholders its own way, and the WHERE is
 * the `buildDrizzleWhere` every other read and write goes through — the raw
 * where builders were removed on purpose and this does not bring one back.
 * It returns at most the rows' identity: a caller who asked for the rows back
 * gets them from a read on the same transaction, decoded the way every read
 * is decoded, rather than from a RETURNING list this module would have to
 * decode a second way — and on a dialect with RETURNING that read is by the
 * identities this statement reports, so it is exactly the rows it changed.
 *
 * A value binds in one of three ways, decided per column:
 *  - a column the model DECLARES binds through that column's own encoder.
 *    `sql.param(value, column)` is the `Param` the query builder would have
 *    made for it, so a date, a JSON document or a boolean reaches the driver
 *    as the bytes the builder sent before this existed — for every caller
 *    that was already using the builder;
 *  - a column it does NOT declare binds through the adapter's own sanitizer,
 *    which is how that adapter's transactional INSERT binds every value;
 *  - a value that is itself a `Column` or an `SQL` fragment is an expression
 *    (`{ destination: table.source }` copies a column) and is written as one,
 *    which is what the query builder's `mapUpdateSet` does with it.
 *
 * A declared column with an `$onUpdate` callback that the caller did not name
 * is assigned the callback's value, as the query builder assigns it on every
 * update it builds.
 *
 * A key whose value is `undefined` is not written at all — JSON's meaning of
 * an absent key, and what the builder's `mapUpdateSet` did with it; under
 * both spellings of one column the later key decides, undefined included.
 * `null` is written as NULL. A key naming no column on the physical table is
 * a SQL error from the database: the query builder was the one path that
 * could not say so, which is the defect the transition window was hiding
 * behind. A patch that names nothing is refused before any `$onUpdate`
 * column is considered, as the query builder refused it.
 *
 * @module update-statement
 */

import { Column, getColumns, is, SQL, sql } from "drizzle-orm";

import { isJsonColumn } from "./column-kinds";
import { buildDrizzleWhere } from "./drizzle-where";
import type { WhereClause } from "./types";

/** What this builder reads off a Drizzle column. */
interface BindableColumn {
  /** The SQL column name. */
  name: string;
  dataType?: unknown;
  columnType?: unknown;
  mapToDriverValue(value: unknown): unknown;
  /** The `$onUpdate` callback, when the column declares one. */
  onUpdateFn?: (() => unknown) | undefined;
}

/** The arguments the adapters hand this builder. */
export interface UpdateStatementInput {
  /** The physical table's name, as the caller addressed it. */
  table: string;
  /**
   * The runtime table object: the statement's target, rendered with its
   * schema when it has one, and the columns that decide how each value binds.
   */
  tableObj: Record<string, unknown>;
  /**
   * Values by column. SQL names and Drizzle property names are both accepted,
   * as `update` has always accepted them; a key matching neither is taken as
   * a physical column name.
   */
  data: Record<string, unknown>;
  where: WhereClause;
  /** How a value binds when the model declares no column for it. */
  bindUnmodeled: (value: unknown) => unknown;
  /**
   * Columns to return from the statement, on a dialect with RETURNING: the
   * row's identity, so the caller can read exactly the rows it changed back
   * through the query API rather than re-run its predicate.
   */
  returning?: SQL[];
}

function isBindableColumn(value: unknown): value is BindableColumn {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { mapToDriverValue?: unknown }).mapToDriverValue ===
      "function"
  );
}

/**
 * A JSON column's encoder serializes whatever it is given, so a value that
 * arrives already serialized would be serialized twice. The query-builder path
 * parses such a string first; this keeps the same bytes on the wire.
 */
function valueForJsonColumn(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * A table's columns, indexed by both spellings a caller may use, and the
 * declared columns in order for the `$onUpdate` sweep.
 */
function columnsOf(tableObj: Record<string, unknown>): {
  byName: Map<string, BindableColumn>;
  declared: BindableColumn[];
} {
  const byName = new Map<string, BindableColumn>();
  const declared: BindableColumn[] = [];
  for (const [jsName, column] of Object.entries(
    getColumns(tableObj as never)
  )) {
    if (!isBindableColumn(column)) continue;
    byName.set(column.name, column);
    byName.set(jsName, column);
    declared.push(column);
  }
  return { byName, declared };
}

/** How one value is written: as the expression it already is, or bound. */
function boundValue(
  value: unknown,
  column: BindableColumn | undefined,
  bindUnmodeled: (value: unknown) => unknown
): SQL {
  if (is(value, SQL) || is(value, Column)) return sql`${value}`;
  if (column) {
    return sql`${sql.param(
      isJsonColumn(column) ? valueForJsonColumn(value) : value,
      column
    )}`;
  }
  return sql`${sql.param(bindUnmodeled(value))}`;
}

/**
 * Build the UPDATE for one table.
 *
 * @returns the statement, or `null` when there is nothing to write — every
 *   key was `undefined`, or there were none. An UPDATE with an empty SET is a
 *   syntax error, so the adapter refuses it by name instead of running it.
 */
export function buildUpdateStatement(input: UpdateStatementInput): SQL | null {
  const { byName, declared } = columnsOf(input.tableObj);
  // Keyed by the SQL column name, so a payload naming one column under both
  // spellings assigns it once, the later value winning — the same collapse
  // the query builder's key normalization performed, and one SET target per
  // column is what the database accepts.
  const assignments = new Map<string, SQL>();

  for (const [key, value] of Object.entries(input.data)) {
    const column = byName.get(key);
    const name = column?.name ?? key;
    // Resolved before the undefined test, so a later `undefined` under the
    // other spelling withdraws the earlier value, as the collapsed object did.
    if (value === undefined) {
      assignments.delete(name);
      continue;
    }
    assignments.set(
      name,
      sql`${sql.identifier(name)} = ${boundValue(value, column, input.bindUnmodeled)}`
    );
  }
  // Refused on what the caller named, before any column adds itself: a
  // patch of nothing must not become an update that bumps a timestamp.
  if (assignments.size === 0) return null;
  // The columns the caller left unnamed that update themselves.
  for (const column of declared) {
    if (assignments.has(column.name) || column.onUpdateFn === undefined) {
      continue;
    }
    const value = column.onUpdateFn();
    assignments.set(
      column.name,
      sql`${sql.identifier(column.name)} = ${boundValue(value, column, input.bindUnmodeled)}`
    );
  }

  // The target is the table object, not the caller's string: a table declared
  // in a schema renders as `"schema"."table"`, which is how the WHERE below
  // already refers to it, and how the query builder targeted it.
  const statement = sql`UPDATE ${input.tableObj} SET ${sql.join([...assignments.values()], sql`, `)}`;
  const condition = buildDrizzleWhere(input.tableObj, input.where);
  if (condition) statement.append(sql` WHERE ${condition}`);
  if (input.returning && input.returning.length > 0) {
    statement.append(sql` RETURNING ${sql.join(input.returning, sql`, `)}`);
  }
  return statement;
}
