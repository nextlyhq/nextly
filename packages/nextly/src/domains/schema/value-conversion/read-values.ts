// Reading a column's stored values for the judgement, a page at a time and by key, and judging
// them.
//
// Each value is read as the database's own text of it, so a 64-bit integer or a decimal reaches the
// judgement with every digit: a driver can hand a BIGINT back as a rounded JavaScript number. SQLite
// also reports how each value is stored, which decides what its rebuild does to it, and MySQL its
// own answer to whether a value is JSON, where the column is becoming JSON.
//
// Rows are read in key order, a page after the last key read, so a large table is never held in
// memory whole and no row is read twice.
//
// @module domains/schema/value-conversion/read-values

import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import type { SupportedDialect } from "../services/field-column-descriptor";

import { parseColumnType } from "./column-type";
import { judgeColumn } from "./judge-column";
import type {
  ColumnConversion,
  ConversionJudgement,
  RowKey,
  SqliteStorage,
  StoredValue,
} from "./types";

interface AsyncExecuteHandle {
  execute(query: SQL): Promise<unknown>;
}

interface SqliteAllHandle {
  all(query: SQL): unknown;
}

/** How many rows one page reads. */
const PAGE_SIZE = 1000;

/** Where a column's values are and how its rows are keyed. */
export interface ValueSource {
  table: string;
  column: string;
  /**
   * `id` for an entity's own table; `translation` for a `_locales` table, whose rows are keyed by
   * their parent and locale.
   */
  keyedBy: "id" | "translation";
  /** The column is becoming JSON, so MySQL is asked whether each value is JSON. */
  toJson: boolean;
}

/** One row as each query returns it: the key's text, the value's text, and the dialect's extras. */
interface ValueRow {
  k1: unknown;
  k2?: unknown;
  v: unknown;
  storage?: unknown;
  json_valid?: unknown;
}

/** Every stored value of `source`, in key order, read a page at a time. */
export async function* readStoredValues(
  db: unknown,
  dialect: SupportedDialect,
  source: ValueSource
): AsyncGenerator<StoredValue> {
  let after: RowKey | null = null;
  for (;;) {
    const page: StoredValue[] = (
      await readPage(db, dialect, source, after)
    ).map(row => storedValue(row, source, dialect));
    yield* page;
    if (page.length < PAGE_SIZE) return;
    after = page[page.length - 1]?.key ?? null;
  }
}

/** A column or key rendered as the dialect's text of it. */
function asText(dialect: SupportedDialect, column: SQLWrapper): SQL {
  if (dialect === "postgresql") return sql`${column}::text`;
  if (dialect === "mysql") return sql`CAST(${column} AS CHAR)`;
  return sql`CAST(${column} AS TEXT)`;
}

/** One page of rows after the key `after` holds, or the first page when it is null. */
async function readPage(
  db: unknown,
  dialect: SupportedDialect,
  source: ValueSource,
  after: RowKey | null
): Promise<ValueRow[]> {
  const table = sql.identifier(source.table);
  const column = sql.identifier(source.column);
  const [k1, k2] =
    source.keyedBy === "translation"
      ? [sql.identifier("_parent"), sql.identifier("_locale")]
      : [sql.identifier("id"), undefined];

  const extras: SQL[] = [];
  if (dialect === "sqlite") extras.push(sql`, typeof(${column}) AS storage`);
  if (dialect === "mysql" && source.toJson) {
    extras.push(sql`, JSON_VALID(${column}) AS json_valid`);
  }

  // Each key is compared as stored, against the text the previous page read of it: the database
  // reads that text back as the key's own type, so the order and the comparison agree.
  let where = sql``;
  if (after !== null) {
    where =
      "id" in after
        ? sql`WHERE ${k1} > ${after.id}`
        : sql`WHERE ${k1} > ${after.parent} OR (${k1} = ${after.parent} AND ${k2} > ${after.locale})`;
  }
  const keys =
    k2 === undefined
      ? sql`${asText(dialect, k1)} AS k1`
      : sql`${asText(dialect, k1)} AS k1, ${asText(dialect, k2)} AS k2`;
  const order = k2 === undefined ? sql`${k1}` : sql`${k1}, ${k2}`;

  const query = sql`SELECT ${keys}, ${asText(dialect, column)} AS v${sql.join(extras)} FROM ${table} ${where} ORDER BY ${order} LIMIT ${PAGE_SIZE}`;
  return rowsOf(await run(db, dialect, query));
}

async function run(
  db: unknown,
  dialect: SupportedDialect,
  query: SQL
): Promise<unknown> {
  if (dialect === "sqlite") return (db as SqliteAllHandle).all(query);
  return (db as AsyncExecuteHandle).execute(query);
}

/**
 * The rows of a result, across the shapes the drivers return: node-postgres `{ rows }`, mysql2
 * `[rows, fields]`, and a plain list from SQLite.
 */
function rowsOf(result: unknown): ValueRow[] {
  if (Array.isArray(result)) {
    const first: unknown = result[0];
    return (Array.isArray(first) ? first : result) as ValueRow[];
  }
  if (result && typeof result === "object" && "rows" in result) {
    const { rows } = result;
    return Array.isArray(rows) ? (rows as ValueRow[]) : [];
  }
  return [];
}

const SQLITE_STORAGE: readonly SqliteStorage[] = [
  "null",
  "integer",
  "real",
  "text",
  "blob",
];

function isSqliteStorage(value: unknown): value is SqliteStorage {
  return SQLITE_STORAGE.some(storage => storage === value);
}

/**
 * A value each query renders as text, as the driver hands it back: a string, or, from mysql2 for a
 * text in a binary character set, its bytes. Anything else means the query did not render it, and
 * a guess at its text could name a different row or judge a different value, so it stops the read.
 */
function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  throw NextlyError.internal({
    logContext: {
      reason: "a stored value was not read back as text",
      type: typeof value,
    },
  });
}

/** A key's text. A key column is never null: it is the table's primary key. */
function keyText(value: unknown): string {
  return textOf(value) ?? "";
}

/** One row as the judgement takes it. */
function storedValue(
  row: ValueRow,
  source: ValueSource,
  dialect: SupportedDialect
): StoredValue {
  const key: RowKey =
    source.keyedBy === "translation"
      ? { parent: keyText(row.k1), locale: keyText(row.k2) }
      : { id: keyText(row.k1) };
  const value: StoredValue = { key, text: textOf(row.v) };
  if (dialect === "sqlite" && isSqliteStorage(row.storage)) {
    value.storage = row.storage;
  }
  if (dialect === "mysql" && source.toJson && row.json_valid !== undefined) {
    value.jsonValid = Number(row.json_valid) === 1;
  }
  return value;
}

/**
 * The judgement of `conversion` over the values `source` holds, read a page at a time. The one way
 * a path that changes a saved column asks whether its rows can convert.
 */
export async function judgeStoredColumn(
  db: unknown,
  conversion: ColumnConversion,
  source: Omit<ValueSource, "toJson">
): Promise<ConversionJudgement> {
  return judgeColumn(
    conversion,
    readStoredValues(db, conversion.dialect, {
      ...source,
      toJson: parseColumnType(conversion.to).family === "json",
    })
  );
}
