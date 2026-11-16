/**
 * What kind of value a Drizzle column stores, asked in one place.
 *
 * The pooled write path and the transactional one both have to know which
 * columns hold JSON, because both parse an already-serialized string before
 * the column's encoder serializes it again. Two lists of the same column
 * types agree on the day they are written and drift when a Drizzle release
 * adds or renames one; this is the one list.
 *
 * @module column-kinds
 */

/** The parts of a Drizzle column a kind test reads. */
export interface ColumnKindInput {
  dataType?: unknown;
  columnType?: unknown;
}

/**
 * Whether a column stores JSON, in the spelling each dialect's column class
 * reports. Drizzle serializes objects for these itself, so a value that
 * arrives already serialized has to be parsed first or it is serialized
 * twice.
 *
 * SQLite matches only text columns declared with `{ mode: "json" }`
 * (`SQLiteTextJson`, dataType `json`). A plain `SQLiteText` column stores a
 * serialized string as it is and must not be parsed, or better-sqlite3 is
 * handed an object it cannot bind.
 */
export function isJsonColumn(column: ColumnKindInput): boolean {
  return (
    column.dataType === "json" ||
    column.columnType === "PgJsonb" ||
    column.columnType === "PgJson" ||
    column.columnType === "MySqlJson" ||
    column.columnType === "SQLiteTextJson"
  );
}

/**
 * The value a JSON column's encoder is handed for `value`: a string is taken
 * for a document that arrives already serialized and parsed, so the encoder
 * serializes it once rather than wrapping it as a JSON string; a string that
 * does not parse is kept, and stored as a JSON string. Every write path that
 * binds a JSON column goes through this, so they store the same bytes.
 */
export function valueForJsonColumn(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * The JSON text a JSON column stores for `value`, for a write that binds it
 * to the driver itself rather than through a Drizzle query. It is what the
 * query path binds for the same value: MySQL's JSON column encoder and
 * node-postgres's JSON codec both send it serialized. A driver handed the bare
 * value makes something else of it: mysql2 spells an object as
 * `[object Object]` and an array as a value list, and node-postgres an array
 * as a PostgreSQL array literal. `null` stays SQL NULL, as on the query path.
 */
export function jsonColumnText(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  return JSON.stringify(valueForJsonColumn(value));
}

/**
 * Whether a value is a structured document — a plain object or an array —
 * rather than a scalar, a date, or binary. What a driver does with one of
 * these when the column is not modelled differs (node-postgres spells an
 * array as a PostgreSQL array literal, mysql2 as a value list), and none of
 * it is JSON; serializing here is what makes the same bytes land everywhere.
 */
export function isStructuredValue(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Date) return false;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return false;
  return true;
}

/**
 * How a value binds to a column the runtime model does not declare, on a
 * driver that binds scalars, dates and binary natively: structured values are
 * serialized as JSON text, everything else passes through.
 */
export function bindStructuredAsJson(value: unknown): unknown {
  return isStructuredValue(value) ? JSON.stringify(value) : value;
}
