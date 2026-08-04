// The two facts about a live table that DDL generation cannot derive from a field list, and
// gets wrong whenever it assumes them.
//
//   1. Whether the table holds any rows. Adding a required column whose type states no usable
//      backfill — a relationship has none, because a fabricated id references nothing — is
//      safe on an empty table and impossible on one with content. The three dialects disagree
//      on how they refuse: PostgreSQL reports the existing nulls, MySQL rejects the statement
//      as invalid, and SQLite accepts it and then rejects every insert that omits the column.
//
//   2. Which columns carry a foreign key. Dropping such a column needs the constraint removed
//      first on MySQL, cannot be done at all on SQLite, and needs nothing on PostgreSQL, which
//      drops constraints that depend on the column along with it.
//
// Both are read from the LIVE table rather than inferred from the fields, because neither is
// recoverable from them. A SQLite relationship column added by a later edit never received a
// foreign key — the ALTER path cannot attach one — while the same field created together with
// its table did, and only the database knows which of the two a given column is.
//
// Per-dialect strategy mirrors `live-column-types`: one information_schema query for PG and
// MySQL, a PRAGMA for SQLite.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

interface PgForeignKeyRow {
  column_name: string;
  constraint_name: string;
}

interface MysqlForeignKeyRow {
  COLUMN_NAME: string;
  CONSTRAINT_NAME: string;
}

interface SqliteForeignKeyRow {
  from: string;
}

interface PgMysqlExecute {
  execute(query: unknown): Promise<unknown>;
}

interface SqliteAll {
  all(query: unknown): unknown[] | Promise<unknown[]>;
}

/**
 * MySQL's driver returns `[rows, fieldPackets]`; some wrappers flatten it to the rows alone.
 * Reading the tuple shape without checking iterates the field packets as if they were rows.
 */
function mysqlRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  if (result.length > 0 && Array.isArray(result[0])) {
    return (result as [T[], unknown])[0];
  }
  return result as T[];
}

/**
 * Whether the table currently holds at least one row.
 *
 * Asked as an existence check rather than a count: the answer only ever decides whether a
 * backfill is needed, and `SELECT 1 ... LIMIT 1` costs the same on a table of ten rows and a
 * table of ten million, where `COUNT(*)` scans.
 */
export async function tableHasRows(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string
): Promise<boolean> {
  const probe = sql`SELECT 1 FROM ${sql.identifier(tableName)} LIMIT 1`;

  if (dialect === "postgresql") {
    // node-postgres returns the QueryResult object, not a flat row array.
    const result = (await (db as PgMysqlExecute).execute(probe)) as {
      rows: unknown[];
    };
    return result.rows.length > 0;
  }

  if (dialect === "mysql") {
    return (
      mysqlRows<unknown>(await (db as PgMysqlExecute).execute(probe)).length > 0
    );
  }

  return (await (db as SqliteAll).all(probe)).length > 0;
}

/**
 * The foreign-key constraints the table carries, keyed by the column they are attached to.
 *
 * Presence of a key is the fact every caller needs; the names matter only to MySQL, which is
 * the one dialect that requires the constraint to be named and dropped before its column can
 * be. SQLite exposes no constraint names, so its entries carry an empty list — a column that
 * appears here has a foreign key whether or not anything can be said about its name.
 */
export async function readForeignKeyColumns(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const record = (column: string, constraint: string | null) => {
    const names = out.get(column) ?? [];
    if (constraint !== null) names.push(constraint);
    out.set(column, names);
  };

  if (dialect === "postgresql") {
    const result = (await (db as PgMysqlExecute).execute(
      sql`SELECT kcu.column_name, tc.constraint_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.constraint_schema = kcu.constraint_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = 'public'
            AND tc.table_name = ${tableName}`
    )) as { rows: PgForeignKeyRow[] };
    for (const row of result.rows) record(row.column_name, row.constraint_name);
    return out;
  }

  if (dialect === "mysql") {
    // A row in KEY_COLUMN_USAGE describes a foreign key only when it names the table it
    // references; the same view also lists primary and unique keys, which have none.
    const rows = mysqlRows<MysqlForeignKeyRow>(
      await (db as PgMysqlExecute).execute(
        sql`SELECT COLUMN_NAME, CONSTRAINT_NAME
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ${tableName}
              AND REFERENCED_TABLE_NAME IS NOT NULL`
      )
    );
    for (const row of rows) record(row.COLUMN_NAME, row.CONSTRAINT_NAME);
    return out;
  }

  const rows = (await (db as SqliteAll).all(
    sql`PRAGMA foreign_key_list(${sql.identifier(tableName)})`
  )) as SqliteForeignKeyRow[];
  for (const row of rows) record(row.from, null);
  return out;
}
