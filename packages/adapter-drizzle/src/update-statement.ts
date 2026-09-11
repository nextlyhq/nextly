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
 *
 * A value binds in one of two ways, decided per column:
 *  - a column the model DECLARES binds through that column's own encoder.
 *    `sql.param(value, column)` is the `Param` the query builder would have
 *    made for it, so a date, a JSON document or a boolean reaches the driver
 *    as the bytes the builder sent before this existed — for every caller
 *    that was already using the builder;
 *  - a column it does NOT declare binds through the adapter's own sanitizer,
 *    which is how that adapter's transactional INSERT binds every value.
 *
 * A key whose value is `undefined` is not written at all — JSON's meaning of
 * an absent key, and what the builder's `mapUpdateSet` did with it. `null` is
 * written as NULL. A key naming no column on the physical table is a SQL
 * error from the database: the query builder was the one path that could not
 * say so, which is the defect the transition window was hiding behind.
 *
 * @module update-statement
 */

import { getColumns, sql, type SQL } from "drizzle-orm";

import { buildDrizzleWhere } from "./drizzle-where";
import type { WhereClause } from "./types";

/** What this builder reads off a Drizzle column. */
interface BindableColumn {
  /** The SQL column name. */
  name: string;
  dataType?: unknown;
  columnType?: unknown;
  mapToDriverValue(value: unknown): unknown;
}

/** The arguments the adapters hand this builder. */
export interface UpdateStatementInput {
  /** The physical table, quoted by the dialect. */
  table: string;
  /** The runtime table object; its columns decide how each value binds. */
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
  /** The rendered RETURNING list, on a dialect that has one, when asked. */
  returning?: SQL;
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
 * Whether a column stores JSON, in the spelling each dialect's column class
 * reports. The same test the query-builder path applies before `.set()`.
 */
function isJsonColumn(column: BindableColumn): boolean {
  return (
    column.dataType === "json" ||
    column.columnType === "PgJsonb" ||
    column.columnType === "PgJson" ||
    column.columnType === "MySqlJson" ||
    // SQLite JSON-mode text only. A plain text column stores a serialized
    // string as it is, and parsing that would hand the driver an object.
    column.columnType === "SQLiteTextJson"
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
 * Index a table's columns by both spellings a caller may use.
 */
function columnsByName(
  tableObj: Record<string, unknown>
): Map<string, BindableColumn> {
  const byName = new Map<string, BindableColumn>();
  for (const [jsName, column] of Object.entries(
    getColumns(tableObj as never)
  )) {
    if (!isBindableColumn(column)) continue;
    byName.set(column.name, column);
    byName.set(jsName, column);
  }
  return byName;
}

/**
 * Build the UPDATE for one table.
 *
 * @returns the statement, or `null` when there is nothing to write — every
 *   key was `undefined`, or there were none. An UPDATE with an empty SET is a
 *   syntax error, so the adapter refuses it by name instead of running it.
 */
export function buildUpdateStatement(input: UpdateStatementInput): SQL | null {
  const columns = columnsByName(input.tableObj);
  const assignments: SQL[] = [];

  for (const [key, value] of Object.entries(input.data)) {
    if (value === undefined) continue;
    const column = columns.get(key);
    const bound = column
      ? sql.param(
          isJsonColumn(column) ? valueForJsonColumn(value) : value,
          column
        )
      : sql.param(input.bindUnmodeled(value));
    assignments.push(sql`${sql.identifier(column?.name ?? key)} = ${bound}`);
  }
  if (assignments.length === 0) return null;

  const statement = sql`UPDATE ${sql.identifier(input.table)} SET ${sql.join(assignments, sql`, `)}`;
  const condition = buildDrizzleWhere(input.tableObj, input.where);
  if (condition) statement.append(sql` WHERE ${condition}`);
  if (input.returning) statement.append(sql` RETURNING ${input.returning}`);
  return statement;
}
