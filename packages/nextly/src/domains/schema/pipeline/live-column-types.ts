// Introspects live database column types so F4's RenameDetector can
// compute typesCompatible flags. The DROP COLUMN SQL statement does not
// carry the column's type; pushSchema's warnings array doesn't either.
// The pipeline calls this helper before its first pushSchema call and
// passes the resulting map to detector.detect().
//
// Per-dialect strategy:
//   - PG / MySQL: single information_schema.columns query, filtered by
//     table-name list. One round trip.
//   - SQLite: PRAGMA table_info("<table>") per table. SQLite has no
//     information_schema. Round-trip count = number of managed tables.
//
// Result shape: Map<tableName, Map<columnName, columnType>>.
// Caller-provided tableNames restrict the scope to managed tables only -
// we never introspect user-owned tables outside our prefix space.
//
// SQLite uses sql.identifier(table) for the PRAGMA arg - drizzle-idiomatic
// and injection-safe even though tableNames are pre-filtered to managed
// prefixes upstream. Verified empirically against better-sqlite3 produces
// the same PRAGMA output as sql.raw with the table name interpolated.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

interface PgRow {
  table_name: string;
  column_name: string;
  udt_name: string;
}

interface MysqlRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
}

interface SqliteRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

interface PgMysqlExecute {
  execute(query: unknown): Promise<unknown>;
}

interface SqliteAll {
  all(query: unknown): SqliteRow[] | Promise<SqliteRow[]>;
}

export async function queryLiveColumnTypes(
  db: unknown,
  dialect: SupportedDialect,
  tableNames: string[]
): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  if (tableNames.length === 0) return out;

  if (dialect === "postgresql") {
    const dbTyped = db as PgMysqlExecute;
    // udt_name (not data_type) returns drizzle-friendly tokens that align
    // with the type-family table: int4 / varchar / timestamptz / uuid /
    // bpchar (for char(N)) / etc. data_type would return "character",
    // "integer", "timestamp with time zone" - more verbose, still valid,
    // but less greppable.
    const rows = (await dbTyped.execute(
      sql`SELECT table_name, column_name, udt_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY(${tableNames})`
    )) as PgRow[];
    for (const row of rows) {
      let cols = out.get(row.table_name);
      if (!cols) {
        cols = new Map<string, string>();
        out.set(row.table_name, cols);
      }
      cols.set(row.column_name, row.udt_name);
    }
    return out;
  }

  if (dialect === "mysql") {
    const dbTyped = db as PgMysqlExecute;
    // MySQL execute() returns [rows, fieldPackets] tuple from mysql2; some
    // wrappers flatten to just rows. Handle both shapes defensively.
    // drizzle-orm wraps a JS array bare-interpolated into IN as a
    // parenthesized parameter list (?, ?, ?) - undocumented but verified
    // in node_modules/drizzle-orm/sql/sql.cjs SQL.buildQueryFromSourceParams.
    // Other call sites in this repo use the explicit sql.join form; we use
    // the bare-array form here for brevity since tableNames is always a
    // small list of managed tables.
    const result = (await dbTyped.execute(
      sql`SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
          FROM information_schema.columns
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME IN ${tableNames}`
    )) as MysqlRow[] | [MysqlRow[], unknown];
    const rows: MysqlRow[] =
      Array.isArray(result) &&
      result.length > 0 &&
      Array.isArray((result as unknown[])[0])
        ? (result as [MysqlRow[], unknown])[0]
        : (result as MysqlRow[]);
    for (const row of rows) {
      let cols = out.get(row.TABLE_NAME);
      if (!cols) {
        cols = new Map<string, string>();
        out.set(row.TABLE_NAME, cols);
      }
      cols.set(row.COLUMN_NAME, row.COLUMN_TYPE);
    }
    return out;
  }

  // SQLite - PRAGMA per table.
  const dbTyped = db as SqliteAll;
  for (const table of tableNames) {
    const rows = await dbTyped.all(
      sql`PRAGMA table_info(${sql.identifier(table)})`
    );
    if (rows.length === 0) continue;
    const cols = new Map<string, string>();
    for (const row of rows) {
      cols.set(row.name, row.type);
    }
    out.set(table, cols);
  }
  return out;
}
