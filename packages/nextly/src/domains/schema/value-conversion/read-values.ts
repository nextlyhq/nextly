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
import { COMPANION_KEY_COLUMNS } from "../../i18n/companion-columns";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import type { ColumnSpec } from "../pipeline/diff/types";
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

/** How many rows one page reads. */
const PAGE_SIZE = 1000;

/**
 * How a table's rows are keyed, which is how a reason names them:
 *
 * - `id`: an entity's own table, keyed by its `id`;
 * - `translation`: a translation table, keyed by its parent and locale;
 * - `none`: a table keyed some other way, read whole in one query. Its rows cannot be named, so it
 *   is for a caller that needs only the class.
 */
export type KeyedBy = "id" | "translation" | "none";

/** Where a column's values are and how its rows are keyed. */
export interface ValueSource {
  table: string;
  column: string;
  keyedBy: KeyedBy;
  /** The column is becoming JSON, so MySQL is asked whether each value is JSON. */
  toJson: boolean;
}

/**
 * How a table with these columns is keyed, read from its primary key rather than from its name: a
 * table whose key is `id` alone by id, one whose key is the parent and the locale as a translation
 * table, anything else by nothing.
 */
export function keyedByOf(columns: readonly ColumnSpec[]): KeyedBy {
  const key = columns
    .filter(column => column.primaryKey === true)
    .map(column => column.name)
    .sort();
  if (key.length === 1 && key[0] === "id") return "id";
  const translation = [...COMPANION_KEY_COLUMNS].sort();
  if (key.length === 2 && key.every((name, i) => name === translation[i])) {
    return "translation";
  }
  return "none";
}

/** One row as each query returns it: the key's text, the value's text, and the dialect's extras. */
interface ValueRow {
  k1?: unknown;
  k2?: unknown;
  v: unknown;
  storage?: unknown;
  real_text?: unknown;
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
    if (source.keyedBy === "none" || page.length < PAGE_SIZE) return;
    after = page[page.length - 1]?.key ?? null;
  }
}

/** A column or key rendered as the dialect's text of it. */
function asText(dialect: SupportedDialect, column: SQLWrapper): SQL {
  if (dialect === "postgresql") return sql`${column}::text`;
  if (dialect === "mysql") return sql`CAST(${column} AS CHAR)`;
  return sql`CAST(${column} AS TEXT)`;
}

/** The key columns a source is read by, in key order. */
function keyColumns(source: ValueSource): SQLWrapper[] {
  if (source.keyedBy === "id") return [sql.identifier("id")];
  if (source.keyedBy === "translation") {
    // In key order: the parent, then the locale.
    return COMPANION_KEY_COLUMNS.map(name => sql.identifier(name));
  }
  return [];
}

/**
 * The rows after `after`. Each key is compared as stored, against the text the previous page read
 * of it: the database reads that text back as the key's own type, so the order and the comparison
 * agree.
 */
function afterKey(keys: readonly SQLWrapper[], after: RowKey | null): SQL {
  if (after === null) return sql``;
  const [k1, k2] = keys;
  if ("id" in after) return sql`WHERE ${k1} > ${after.id}`;
  return sql`WHERE ${k1} > ${after.parent} OR (${k1} = ${after.parent} AND ${k2} > ${after.locale})`;
}

/** One page of rows after the key `after` holds, or the first page when it is null. */
async function readPage(
  db: unknown,
  dialect: SupportedDialect,
  source: ValueSource,
  after: RowKey | null
): Promise<ValueRow[]> {
  const column = sql.identifier(source.column);
  const keys = keyColumns(source);
  const selected = [
    ...keys.map(
      (key, i) => sql`${asText(dialect, key)} AS ${sql.raw(`k${i + 1}`)}`
    ),
    sql`${asText(dialect, column)} AS v`,
  ];
  if (dialect === "sqlite") {
    selected.push(sql`typeof(${column}) AS storage`);
    // A REAL's every digit: `CAST(.. AS TEXT)` gives 15 significant digits before SQLite 3.43.
    selected.push(
      sql`CASE WHEN typeof(${column}) = 'real' THEN printf('%!.17g', ${column}) END AS real_text`
    );
  }
  if (dialect === "mysql" && source.toJson) {
    selected.push(sql`JSON_VALID(${column}) AS json_valid`);
  }
  const page =
    keys.length === 0
      ? sql``
      : sql`${afterKey(keys, after)} ORDER BY ${sql.join(keys, sql`, `)} LIMIT ${PAGE_SIZE}`;
  return querySqlRows<ValueRow>(
    db,
    dialect,
    sql`SELECT ${sql.join(selected, sql`, `)} FROM ${sql.identifier(source.table)} ${page}`
  );
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

/** The key a row is named by. A table keyed by nothing names no row. */
function keyOf(row: ValueRow, keyedBy: KeyedBy): RowKey {
  if (keyedBy === "translation") {
    return { parent: keyText(row.k1), locale: keyText(row.k2) };
  }
  return { id: keyedBy === "id" ? keyText(row.k1) : "" };
}

/** One row as the judgement takes it. */
function storedValue(
  row: ValueRow,
  source: ValueSource,
  dialect: SupportedDialect
): StoredValue {
  const value: StoredValue = {
    key: keyOf(row, source.keyedBy),
    text: textOf(row.v),
  };
  if (dialect === "sqlite" && isSqliteStorage(row.storage)) {
    value.storage = row.storage;
    const exactReal = textOf(row.real_text);
    if (row.storage === "real" && exactReal !== null) {
      value.exactReal = exactReal;
    }
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
