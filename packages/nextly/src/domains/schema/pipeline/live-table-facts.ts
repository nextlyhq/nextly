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
 * Asked as an existence check rather than a count: every caller needs only the yes or no — is a
 * backfill needed, may an unregistered table be dropped — and `SELECT 1 ... LIMIT 1` costs the
 * same on a table of ten rows and a table of ten million, where `COUNT(*)` scans.
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
 * The names of the tables that hold a foreign key REFERENCING the given table.
 *
 * The reverse of {@link readForeignKeyColumns}, and read from the live catalog for the same
 * reason: which junction and companion tables point at a parent is decided by whichever path
 * created them, not derivable from a field list — least of all for a table whose registry row is
 * gone. A parent with referencing tables cannot simply be dropped: MySQL refuses the drop outright
 * while the reference stands, and PostgreSQL's CASCADE silently strips the referrer's constraint
 * instead, so the caller has to deal with the referrers first either way.
 */
export async function readReferencingTables(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string
): Promise<string[]> {
  const names = new Set<string>();

  if (dialect === "postgresql") {
    // Through the referenced relation, mirroring `readIndexNames`: `to_regclass` resolves the
    // name the way the statements themselves will, across the whole search path.
    const result = (await (db as PgMysqlExecute).execute(
      sql`SELECT DISTINCT r.relname AS table_name
          FROM pg_constraint c
          JOIN pg_class r ON r.oid = c.conrelid
          WHERE c.contype = 'f' AND c.confrelid = to_regclass(${tableName})`
    )) as { rows: { table_name: string }[] };
    for (const row of result.rows) names.add(row.table_name);
    return [...names];
  }

  if (dialect === "mysql") {
    const rows = mysqlRows<{ TABLE_NAME: string }>(
      await (db as PgMysqlExecute).execute(
        sql`SELECT DISTINCT TABLE_NAME
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND REFERENCED_TABLE_NAME = ${tableName}`
      )
    );
    for (const row of rows) names.add(row.TABLE_NAME);
    return [...names];
  }

  // SQLite has no reverse foreign-key view, but `pragma_foreign_key_list` is a table-valued
  // function, so one join over `sqlite_master` reads every table's outgoing keys and filters to
  // those aimed at the parent.
  const rows = (await (db as SqliteAll).all(
    sql`SELECT DISTINCT m.name AS table_name
        FROM sqlite_master AS m
        JOIN pragma_foreign_key_list(m.name) AS fk
        WHERE m.type = 'table' AND fk."table" = ${tableName}`
  )) as { table_name: string }[];
  for (const row of rows) names.add(row.table_name);
  return [...names];
}

/**
 * The names of the indexes the table currently carries.
 *
 * Whether a column is indexed is not derivable from its field: an index is created by the path
 * that added the column, and the paths have not always agreed on which columns get one, so a
 * table can carry a relationship column with no index beside an identical one that has it.
 * MySQL has no `DROP INDEX IF EXISTS`, so dropping one that is not there aborts the migration
 * before the statements that follow it.
 */
export async function readIndexNames(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string
): Promise<Set<string>> {
  const names = new Set<string>();

  if (dialect === "postgresql") {
    // Resolved through the relation itself rather than by schema name. An unqualified statement
    // resolves across the WHOLE search path, so a table in `public` reached from a search path of
    // `tenant, public` is found by the ALTER and missed by any predicate naming one schema —
    // including `current_schema()`, which is only the first entry. `to_regclass` answers the
    // question the statements actually ask.
    const result = (await (db as PgMysqlExecute).execute(
      sql`SELECT c.relname AS indexname
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
          WHERE i.indrelid = to_regclass(${tableName})`
    )) as { rows: { indexname: string }[] };
    for (const row of result.rows) names.add(row.indexname);
    return names;
  }

  if (dialect === "mysql") {
    const rows = mysqlRows<{ INDEX_NAME: string }>(
      await (db as PgMysqlExecute).execute(
        sql`SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${tableName}`
      )
    );
    for (const row of rows) names.add(row.INDEX_NAME);
    return names;
  }

  const rows = (await (db as SqliteAll).all(
    sql`PRAGMA index_list(${sql.identifier(tableName)})`
  )) as { name: string }[];
  for (const row of rows) names.add(row.name);
  return names;
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
    // Against the relation, for the same reason as `readIndexNames`: the schema a name resolves
    // to is whatever the search path finds first, not whichever one is listed first.
    const result = (await (db as PgMysqlExecute).execute(
      sql`SELECT a.attname AS column_name, c.conname AS constraint_name
          FROM pg_constraint c
          JOIN unnest(c.conkey) AS k(attnum) ON true
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          WHERE c.contype = 'f' AND c.conrelid = to_regclass(${tableName})`
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
