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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import type {
  ColumnSpec,
  IndexSpec,
  NextlySchemaSnapshot,
  TableSpec,
} from "./types";

/** A single (table, index, column) row from a per-dialect index query. */
interface IndexRow {
  table: string;
  index: string;
  unique: boolean;
  column: string;
}

/**
 * Group index rows (one per index column, ordered) by table + index name, and
 * attach an `indexes` array to every table in the snapshot. Every table gets a
 * DEFINED array (possibly empty) — introspection never leaves it undefined, so
 * the diff sentinel only ever comes from pre-C1 on-disk snapshots.
 */
function attachIndexes(snapshot: NextlySchemaSnapshot, rows: IndexRow[]): void {
  const byTable = new Map<
    string,
    Map<string, { unique: boolean; columns: string[] }>
  >();
  for (const r of rows) {
    let indexes = byTable.get(r.table);
    if (!indexes) {
      indexes = new Map();
      byTable.set(r.table, indexes);
    }
    let idx = indexes.get(r.index);
    if (!idx) {
      idx = { unique: r.unique, columns: [] };
      indexes.set(r.index, idx);
    }
    idx.columns.push(r.column);
  }
  for (const t of snapshot.tables) {
    const indexes = byTable.get(t.name);
    t.indexes = indexes
      ? [...indexes.entries()].map(
          ([name, v]): IndexSpec => ({
            name,
            columns: v.columns,
            unique: v.unique,
          })
        )
      : [];
  }
}

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

interface MysqlIndexRow {
  TABLE_NAME: string;
  INDEX_NAME: string;
  NON_UNIQUE: number | string;
  COLUMN_NAME: string;
  SEQ_IN_INDEX: number;
}

interface SqliteIndexListRow {
  name: string;
  unique: number;
  origin: string;
}

interface SqliteIndexInfoRow {
  name: string;
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
    const snapshot = buildSnapshotFromPgRows(result.rows);
    // Index query: join pg_index/pg_class/pg_attribute. Exclude primary keys
    // (indisprimary) and partial indexes (indpred). Expression indexes yield no
    // pg_attribute row and are naturally excluded.
    const idxResult = (await dbTyped.execute(
      sql`SELECT t.relname AS table, i.relname AS index, ix.indisunique AS unique,
                 a.attname AS column, array_position(ix.indkey, a.attnum) AS ord
          FROM pg_class t
          JOIN pg_index ix ON ix.indrelid = t.oid
          JOIN pg_class i ON i.oid = ix.indexrelid
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
          WHERE t.relname IN (${tableNamesIn})
            AND ix.indisprimary = false
            AND ix.indpred IS NULL
            AND a.attnum > 0
          ORDER BY t.relname, i.relname, ord`
    )) as {
      rows: { table: string; index: string; unique: boolean; column: string }[];
    };
    attachIndexes(
      snapshot,
      idxResult.rows.map(r => ({
        table: r.table,
        index: r.index,
        unique: r.unique,
        column: r.column,
      }))
    );
    return snapshot;
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
    const snapshot = buildSnapshotFromMysqlRows(rows);
    // Index query: information_schema.STATISTICS. Exclude PRIMARY.
    const idxRaw = (await dbTyped.execute(
      sql`SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
          FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME IN (${tableNamesIn})
            AND INDEX_NAME <> 'PRIMARY'
          ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`
    )) as MysqlIndexRow[] | [MysqlIndexRow[], unknown];
    const idxRows: MysqlIndexRow[] =
      Array.isArray(idxRaw) &&
      idxRaw.length > 0 &&
      Array.isArray((idxRaw as unknown[])[0])
        ? (idxRaw as [MysqlIndexRow[], unknown])[0]
        : (idxRaw as MysqlIndexRow[]);
    attachIndexes(
      snapshot,
      idxRows.map(r => ({
        table: r.TABLE_NAME,
        index: r.INDEX_NAME,
        unique: Number(r.NON_UNIQUE) === 0,
        column: r.COLUMN_NAME,
      }))
    );
    return snapshot;
  }

  // SQLite - PRAGMA per table; no information_schema.
  const dbTyped = db as SqliteAll;
  const dbAny = db as {
    all(query: unknown): SqliteIndexListRow[] | Promise<SqliteIndexListRow[]>;
  };
  const tables: TableSpec[] = [];
  for (const table of tableNames) {
    const rows = await dbTyped.all(
      sql`PRAGMA table_info(${sql.identifier(table)})`
    );
    if (rows.length === 0) continue;
    // Indexes: PRAGMA index_list + index_info. Filter pk-origin indexes and
    // SQLite's auto-created sqlite_autoindex_* (unique-constraint backed).
    const idxList = await dbAny.all(
      sql`PRAGMA index_list(${sql.identifier(table)})`
    );
    const indexes: IndexSpec[] = [];
    for (const ix of idxList) {
      if (ix.origin === "pk") continue;
      if (ix.name.startsWith("sqlite_autoindex_")) continue;
      const infoRows = (await dbAny.all(
        sql`PRAGMA index_info(${sql.identifier(ix.name)})`
      )) as unknown as SqliteIndexInfoRow[];
      indexes.push({
        name: ix.name,
        columns: infoRows.map(r => r.name),
        unique: ix.unique === 1,
      });
    }
    tables.push({
      name: table,
      indexes,
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
          // SQLite stores notnull as 0/1 integer. A PRIMARY KEY column is
          // reported nullable unless it was declared NOT NULL, because only
          // INTEGER PRIMARY KEY (the rowid alias) is implicitly NOT NULL in
          // SQLite. The desired side has no such quirk: Drizzle's
          // `.primaryKey()` means NOT NULL. Reporting the storage answer here
          // makes every primary key look like a pending NOT NULL addition,
          // which the classifier calls destructive and which therefore refuses
          // the entire core reconcile — on a database nobody has changed.
          nullable: r.notnull === 0 && r.pk === 0,
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
