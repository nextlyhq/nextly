// Per-dialect count queries used by RealClassifier to populate
// add_not_null_with_nulls events with the NULL row count seen in the live
// DB at preview/apply time.
//
// Identifiers are guarded against quote injection via a strict regex —
// drizzle's sql.identifier could also work, but we want explicit fail-fast
// behavior on adversarial table names so that misuse is loud, not silent.
//
// Per-dialect db shapes mirror introspect-live.ts conventions:
//   - PG: db.execute() returns { rows: T[] }
//   - MySQL: db.execute() returns T[] OR [T[], fieldPackets] (defensive)
//   - SQLite: db.all() returns T[] (no execute()); take first row.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../../errors";

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdent(name: string, dialect: SupportedDialect): string {
  if (!SAFE_IDENT.test(name)) {
    throw new Error(
      `unsafe identifier: ${name} (only [A-Za-z_][A-Za-z0-9_]* allowed)`
    );
  }
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

interface PgMysqlExecute {
  execute(query: unknown): Promise<unknown>;
}

interface SqliteAll {
  all(query: unknown): Array<{ count: string | number }>;
}

interface CountRow {
  count: string | number;
}

function asNumber(raw: string | number | undefined): number {
  if (raw === undefined) return 0;
  return typeof raw === "string" ? parseInt(raw, 10) : raw;
}

// Extracts a count from per-dialect db result shapes. Throws if shape is
// unrecognized so silent zero-counts can't mask broken integrations.
function extractCount(raw: unknown, dialect: SupportedDialect): number {
  if (dialect === "postgresql") {
    // pg: { rows: [{ count: "3" }] }
    const rows = (raw as { rows?: CountRow[] }).rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("PG count query returned no rows");
    }
    return asNumber(rows[0].count);
  }
  if (dialect === "mysql") {
    // mysql2 wraps in [rows, fieldPackets] tuple OR returns flat rows.
    if (
      Array.isArray(raw) &&
      raw.length > 0 &&
      Array.isArray((raw as unknown[])[0])
    ) {
      const rows = (raw as [CountRow[], unknown])[0];
      if (rows.length === 0)
        throw new Error("MySQL count query returned no rows");
      return asNumber(rows[0].count);
    }
    if (Array.isArray(raw)) {
      const rows = raw as CountRow[];
      if (rows.length === 0)
        throw new Error("MySQL count query returned no rows");
      return asNumber(rows[0].count);
    }
    throw new Error("MySQL count query returned unrecognized shape");
  }
  // SQLite handled by caller before extractCount runs.
  throw new Error(`unrecognized dialect for extractCount: ${dialect}`);
}

export async function countNulls(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  column: string
): Promise<number> {
  const tbl = quoteIdent(table, dialect);
  const col = quoteIdent(column, dialect);
  const query = sql.raw(
    `SELECT COUNT(*) AS count FROM ${tbl} WHERE ${col} IS NULL`
  );
  if (dialect === "sqlite") {
    const dbTyped = db as SqliteAll;
    const rows = dbTyped.all(query);
    if (rows.length === 0)
      throw new Error("SQLite count query returned no rows");
    return asNumber(rows[0].count);
  }
  const dbTyped = db as PgMysqlExecute;
  const result = await dbTyped.execute(query);
  return extractCount(result, dialect);
}

/**
 * How many rows hold a value in `column` longer than `length` characters: the values a narrowing to
 * `varchar(length)` would cut short. Counted in characters, as `varchar(N)` bounds them, by each
 * dialect's character-length function. The names go through Drizzle's identifier quoting, which
 * escapes them, and the length is a bound parameter, so nothing reaches the SQL text as a string.
 * A name is not narrowed to a stricter grammar than the naming rules accept: a configured `dbName`
 * such as `my-table` is created verbatim, and its narrowing must be countable.
 */
export async function countLongerThan(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  column: string,
  length: number
): Promise<number> {
  const charLength = dialect === "sqlite" ? sql`length` : sql`CHAR_LENGTH`;
  return readCount(
    db,
    dialect,
    sql`SELECT COUNT(*) AS count FROM ${sql.identifier(table)} WHERE ${charLength}(${sql.identifier(column)}) > ${length}`
  );
}

/**
 * How many rows hold a value in `column`: what dropping the column loses, which the data-loss
 * listing shows beside it. `COUNT(column)` counts the non-null values and nothing else. The names
 * go through Drizzle's identifier quoting, as `countLongerThan`'s do.
 */
export async function countNonEmpty(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  column: string
): Promise<number> {
  return readCount(
    db,
    dialect,
    sql`SELECT COUNT(${sql.identifier(column)}) AS count FROM ${sql.identifier(table)}`
  );
}

/**
 * A count query's one number, read from each dialect's result shape: SQLite's synchronous `all`,
 * the others' `execute`. A query that returns no row is a broken integration, never a zero.
 */
async function readCount(
  db: unknown,
  dialect: SupportedDialect,
  query: SQL
): Promise<number> {
  if (dialect === "sqlite") {
    const rows = (db as SqliteAll).all(query);
    if (rows.length === 0) {
      throw NextlyError.internal({
        logContext: { reason: "count query returned no rows", dialect },
      });
    }
    return asNumber(rows[0].count);
  }
  return extractCount(await (db as PgMysqlExecute).execute(query), dialect);
}

export async function countRows(
  db: unknown,
  dialect: SupportedDialect,
  table: string
): Promise<number> {
  const tbl = quoteIdent(table, dialect);
  const query = sql.raw(`SELECT COUNT(*) AS count FROM ${tbl}`);
  if (dialect === "sqlite") {
    const dbTyped = db as SqliteAll;
    const rows = dbTyped.all(query);
    if (rows.length === 0)
      throw new Error("SQLite count query returned no rows");
    return asNumber(rows[0].count);
  }
  const dbTyped = db as PgMysqlExecute;
  const result = await dbTyped.execute(query);
  return extractCount(result, dialect);
}

/** One row of a grouped count: the language, then one count per column, as `n0`, `n1`, … */
type GroupCountRow = { locale: string } & Record<string, string | number>;

/** Every row of a query, from each dialect's result shape. */
function extractRows<T>(raw: unknown, dialect: SupportedDialect): T[] {
  if (dialect === "postgresql") {
    const rows = (raw as { rows?: T[] }).rows;
    if (!Array.isArray(rows)) {
      throw NextlyError.internal({
        logContext: { reason: "query returned no rows array", dialect },
      });
    }
    return rows;
  }
  if (dialect === "mysql") {
    if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
      return (raw as [T[], unknown])[0];
    }
    if (Array.isArray(raw)) return raw as T[];
    throw NextlyError.internal({
      logContext: { reason: "query returned an unrecognized shape", dialect },
    });
  }
  // SQLite reads its rows through `all`, so it never reaches here.
  throw NextlyError.internal({
    logContext: { reason: "no row reader for this dialect", dialect },
  });
}

/**
 * Every row a raw read returns, from each dialect's result shape: a reader shaped like an
 * adapter's `executeQuery`, for code that holds only the Drizzle handle.
 */
export async function queryRows<T>(
  db: unknown,
  dialect: SupportedDialect,
  text: string
): Promise<T[]> {
  const query = sql.raw(text);
  return dialect === "sqlite"
    ? (db as { all(q: unknown): T[] }).all(query)
    : extractRows<T>(await (db as PgMysqlExecute).execute(query), dialect);
}

/**
 * How many rows of a companion `<table>_locales` hold a value in each of `columns`, for each
 * language except `excludeLocale`, in one grouped query. A language with no value in a column is
 * absent from that column's answer.
 *
 * What fields leaving translation send to the archive, counted before it happens: every
 * non-default language's non-null value. `COUNT(column)` counts exactly those, so every column is
 * counted in the same pass over the table rather than one query each.
 */
export async function countValuesByLocale(
  db: unknown,
  dialect: SupportedDialect,
  companionTable: string,
  columns: readonly string[],
  excludeLocale: string
): Promise<Map<string, Record<string, number>>> {
  const counts = new Map<string, Record<string, number>>(
    columns.map(c => [c, {}])
  );
  if (columns.length === 0) return counts;
  const tbl = quoteIdent(companionTable, dialect);
  const locale = quoteIdent("_locale", dialect);
  const perColumn = columns
    .map((c, i) => `COUNT(${quoteIdent(c, dialect)}) AS n${i}`)
    .join(", ");
  const query = sql`${sql.raw(
    `SELECT ${locale} AS locale, ${perColumn} FROM ${tbl} WHERE ${locale} <> `
  )}${excludeLocale}${sql.raw(` GROUP BY ${locale}`)}`;
  const rows =
    dialect === "sqlite"
      ? (db as { all(q: unknown): GroupCountRow[] }).all(query)
      : extractRows<GroupCountRow>(
          await (db as PgMysqlExecute).execute(query),
          dialect
        );
  for (const row of rows) {
    columns.forEach((column, i) => {
      const n = asNumber(row[`n${i}`]);
      const byLocale = counts.get(column);
      if (byLocale && n > 0) byLocale[String(row.locale)] = n;
    });
  }
  return counts;
}

/**
 * How many entries of a companion `<table>_locales` have no row in `locale`. Such an entry's
 * shared value comes from another language when a field leaves translation
 * (`buildDefaultLocaleRestoreStatements`), so the preview names how many there are.
 */
export async function countParentsWithoutLocale(
  db: unknown,
  dialect: SupportedDialect,
  companionTable: string,
  locale: string
): Promise<number> {
  const tbl = quoteIdent(companionTable, dialect);
  const parent = quoteIdent("_parent", dialect);
  const loc = quoteIdent("_locale", dialect);
  const query = sql`${sql.raw(
    `SELECT COUNT(DISTINCT ${parent}) AS count FROM ${tbl} WHERE ${parent} NOT IN (SELECT ${parent} FROM ${tbl} WHERE ${loc} = `
  )}${locale}${sql.raw(")")}`;
  if (dialect === "sqlite") {
    const [row] = (db as { all(q: unknown): { count: number }[] }).all(query);
    return asNumber(row?.count);
  }
  return extractCount(await (db as PgMysqlExecute).execute(query), dialect);
}
