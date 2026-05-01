// Builds a NextlySchemaSnapshot by introspecting the live database. This is
// the "previous state" input to our diff engine.
//
// Extends F4 PR 1's live-column-types helper, which only captured column
// TYPES (used for rename type-compat checks). This helper builds a fuller
// picture (column + type + nullable + default) needed for the full diff.
//
// Per-dialect strategy:
//   - PG: information_schema.columns single query
//   - MySQL: information_schema.columns scoped to current database
//   - SQLite: PRAGMA table_info per table (no information_schema)
//
// Return shape: NextlySchemaSnapshot { tables: [{name, columns: [...]}] }
// Caller-provided tableNames restrict scope to MANAGED tables only - we
// never introspect user-owned tables outside our prefix space.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import type { ColumnSpec, NextlySchemaSnapshot, TableSpec } from "./types";

interface PgRow {
  table_name: string;
  column_name: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
}

interface MysqlRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: "YES" | "NO";
  COLUMN_DEFAULT: string | null;
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

export async function introspectLiveSnapshot(
  db: unknown,
  dialect: SupportedDialect,
  tableNames: string[]
): Promise<NextlySchemaSnapshot> {
  if (tableNames.length === 0) return { tables: [] };

  // Build IN clause via sql.join (canonical drizzle idiom). Bare-array
  // interpolation flattens incorrectly for PG ANY() per F4 PR 2's findings.
  const tableNamesIn = sql.join(
    tableNames.map(t => sql`${t}`),
    sql`, `
  );

  if (dialect === "postgresql") {
    const dbTyped = db as PgMysqlExecute;
    // udt_name returns drizzle-friendly tokens (int4, varchar, timestamptz,
    // bpchar) that align with the type-family table. is_nullable is "YES"
    // or "NO". column_default is the raw expression as written.
    //
    // drizzle-orm/node-postgres returns pg QueryResult { rows, rowCount, ... }.
    const result = (await dbTyped.execute(
      sql`SELECT table_name, column_name, udt_name, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN (${tableNamesIn})
          ORDER BY table_name, ordinal_position`
    )) as { rows: PgRow[] };
    return buildSnapshotFromPgRows(result.rows);
  }

  if (dialect === "mysql") {
    const dbTyped = db as PgMysqlExecute;
    // mysql2's execute returns a [rows, fieldPackets] tuple; drizzle-orm/mysql2
    // sometimes wraps it. Handle both shapes defensively.
    const result = (await dbTyped.execute(
      sql`SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
          FROM information_schema.columns
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME IN (${tableNamesIn})
          ORDER BY TABLE_NAME, ORDINAL_POSITION`
    )) as MysqlRow[] | [MysqlRow[], unknown];
    const rows: MysqlRow[] =
      Array.isArray(result) &&
      result.length > 0 &&
      Array.isArray((result as unknown[])[0])
        ? (result as [MysqlRow[], unknown])[0]
        : (result as MysqlRow[]);
    return buildSnapshotFromMysqlRows(rows);
  }

  // SQLite - PRAGMA per table; no information_schema.
  const dbTyped = db as SqliteAll;
  const tables: TableSpec[] = [];
  for (const table of tableNames) {
    const rows = await dbTyped.all(
      sql`PRAGMA table_info(${sql.identifier(table)})`
    );
    if (rows.length === 0) continue;
    tables.push({
      name: table,
      columns: rows.map(
        (r): ColumnSpec => ({
          name: r.name,
          // SQLite's PRAGMA table_info auto-uppercases the type name
          // ("text" becomes "TEXT"), even though Drizzle emits lowercase
          // declarations in CREATE TABLE. The
          // `field-column-descriptor` (the desired-side source of
          // truth) renders lowercase tokens to match drizzle-orm's
          // own introspection convention. Without this lowercase
          // pass, every boot/HMR diff sees fake `TEXT -> text`
          // type-change events on every column and classifies the
          // collection as "needs review", which silently blocks
          // legitimate code-first applies (rename, add, drop) from
          // ever running. Lowercasing here is safe because SQLite
          // type names are case-insensitive at the engine level.
          type: r.type.toLowerCase(),
          // SQLite stores notnull as 0/1 integer.
          nullable: r.notnull === 0,
          // dflt_value can be string, number, null, or undefined.
          // Coerce primitives to string; treat anything non-primitive as
          // missing (defensive - SQLite never returns object defaults).
          default: stringifyDefault(r.dflt_value),
        })
      ),
    });
  }
  return { tables };
}

function stringifyDefault(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  // Unexpected shape (object, function, symbol) - defensively skip rather
  // than risk "[object Object]" appearing in a default expression.
  return undefined;
}

function buildSnapshotFromPgRows(rows: PgRow[]): NextlySchemaSnapshot {
  const byTable = new Map<string, ColumnSpec[]>();
  for (const r of rows) {
    let cols = byTable.get(r.table_name);
    if (!cols) {
      cols = [];
      byTable.set(r.table_name, cols);
    }
    cols.push({
      name: r.column_name,
      type: r.udt_name,
      nullable: r.is_nullable === "YES",
      default: r.column_default ?? undefined,
    });
  }
  return {
    tables: [...byTable.entries()].map(
      ([name, columns]): TableSpec => ({ name, columns })
    ),
  };
}

function buildSnapshotFromMysqlRows(rows: MysqlRow[]): NextlySchemaSnapshot {
  const byTable = new Map<string, ColumnSpec[]>();
  for (const r of rows) {
    let cols = byTable.get(r.TABLE_NAME);
    if (!cols) {
      cols = [];
      byTable.set(r.TABLE_NAME, cols);
    }
    cols.push({
      name: r.COLUMN_NAME,
      type: r.COLUMN_TYPE,
      nullable: r.IS_NULLABLE === "YES",
      default: r.COLUMN_DEFAULT ?? undefined,
    });
  }
  return {
    tables: [...byTable.entries()].map(
      ([name, columns]): TableSpec => ({ name, columns })
    ),
  };
}
