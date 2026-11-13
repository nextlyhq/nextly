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
import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import {
  identifierCaseRules,
  indexCatalog,
  resolveCatalogName,
} from "../utils/resolve-catalog-name";

import { queryLiveColumnTypes } from "./live-column-types";

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
/**
 * The rows a query returned.
 *
 * Each dialect hands its rows back differently — node-postgres wraps them in a
 * QueryResult, mysql2 may or may not nest them in a tuple, better-sqlite3
 * returns a plain array — and every caller reading rows had to spell all three.
 * Asked here once so another caller cannot get one of the three shapes subtly
 * wrong.
 */
async function rowsOf<T>(
  db: unknown,
  dialect: SupportedDialect,
  query: SQL
): Promise<T[]> {
  if (dialect === "postgresql") {
    // node-postgres returns the QueryResult object, not a flat row array.
    const result = (await (db as PgMysqlExecute).execute(query)) as {
      rows: T[];
    };
    return result.rows;
  }
  if (dialect === "mysql") {
    return mysqlRows<T>(await (db as PgMysqlExecute).execute(query));
  }
  return (await (db as SqliteAll).all(query)) as T[];
}

/** Whether a probe returned at least one row. */
async function probeReturnsRow(
  db: unknown,
  dialect: SupportedDialect,
  probe: SQL
): Promise<boolean> {
  return (await rowsOf<unknown>(db, dialect, probe)).length > 0;
}

export async function tableHasRows(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string
): Promise<boolean> {
  return probeReturnsRow(
    db,
    dialect,
    sql`SELECT 1 FROM ${sql.identifier(tableName)} LIMIT 1`
  );
}

/**
 * The views (materialized ones included) that read the table, on PostgreSQL: objects a
 * `DROP TABLE ... CASCADE` removes along with it without being asked about, since they hold no
 * foreign key `readReferencingTables` would find. MySQL and SQLite leave a view standing over a
 * dropped table rather than removing it, so they answer none.
 */
export async function readDependentViews(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string
): Promise<string[]> {
  if (dialect !== "postgresql") return [];
  const rows = await rowsOf<{ view_name: string }>(
    db,
    dialect,
    sql`SELECT DISTINCT v.relname AS view_name
        FROM pg_depend d
        JOIN pg_rewrite r ON r.oid = d.objid
        JOIN pg_class v ON v.oid = r.ev_class
        WHERE d.refobjid = to_regclass(${tableName}) AND v.oid <> d.refobjid`
  );
  return rows.map(row => row.view_name);
}

/**
 * How many rows the table holds: what a refusal to build over a standing table names, so whoever
 * deals with it can tell a stray test row from real content. `COUNT(*)` reads the whole table, so
 * it is asked only of a table already known to hold rows (`tableHasRows`).
 */
export async function countTableRows(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string
): Promise<number> {
  const [row] = await rowsOf<{ n: unknown }>(
    db,
    dialect,
    sql`SELECT COUNT(*) AS n FROM ${sql.identifier(tableName)}`
  );
  return Number(row?.n ?? 0);
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
/**
 * The functions the database defines outside its system catalogs, lower-cased:
 * the ones a statement calling them may run code through that the statement
 * does not show. PostgreSQL's from every schema but `pg_catalog` and
 * `information_schema`, an installed extension's members (`uuid_generate_v4`,
 * pgcrypto's) counting as system ones (`PG_USER_FUNCTIONS`); MySQL's stored
 * functions in the current database; SQLite defines none in SQL.
 */
export async function readUserFunctions(
  db: unknown,
  dialect: SupportedDialect
): Promise<Set<string>> {
  const names = new Set<string>();
  if (dialect === "postgresql") {
    const result = (await (db as PgMysqlExecute).execute(
      sql`SELECT DISTINCT p.proname AS name
          FROM pg_proc p
          WHERE p.oid IN (${PG_USER_FUNCTIONS})`
    )) as { rows: { name: string }[] };
    for (const row of result.rows) names.add(row.name.toLowerCase());
    return names;
  }
  if (dialect === "mysql") {
    const rows = mysqlRows<{ ROUTINE_NAME: string }>(
      await (db as PgMysqlExecute).execute(
        sql`SELECT ROUTINE_NAME
            FROM information_schema.ROUTINES
            WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'FUNCTION'`
      )
    );
    for (const row of rows) names.add(row.ROUTINE_NAME.toLowerCase());
  }
  return names;
}

/**
 * What the live table says about these columns: which hold a NULL today, and
 * which are not there at all.
 *
 * THREE states, not two, and collapsing the third into "clean" is a defect.
 * A column the catalog does not report is not a column with no nulls — it is a
 * column whose `ADD` has not been applied yet, and applying it over a table
 * that already has rows creates it holding NULL in every one of them. Reporting
 * that as "no nulls" lets a save tighten it, and the deployment then adds the
 * column in one migration and fails on `SET NOT NULL` in the next, after MySQL
 * has auto-committed the first. So absence is returned as its own answer and
 * the caller decides, with `tableHasRows`, what it means.
 *
 * Asked per column rather than for the whole table: the caller knows the short
 * list a save is about to make required, and probing every column would read
 * the table once per column for nothing.
 *
 * A PRECONDITION, not a diagnostic. The tightening fails at the server after
 * the statements before it have run, so the edit is refused before any of them
 * is written rather than discovered partway.
 */
export async function readColumnNullState(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string,
  columns: readonly string[]
): Promise<{ holdingNull: Set<string>; absent: Set<string> }> {
  const holdingNull = new Set<string>();
  const absent = new Set<string>();
  if (columns.length === 0) return { holdingNull, absent };

  // Narrowed to the columns the table ACTUALLY has, read from the catalog,
  // before a single probe is issued. A caller cannot know this from the field
  // definitions and twice did not: a localized collection keeps its
  // translatable columns in a companion, and a deployment holding an unapplied
  // migration has a field whose column does not exist yet. Both produced a
  // probe for a missing column, which errors and takes the whole save with it.
  //
  // A boundary rather than another prediction — a filter over definitions has
  // to enumerate every reason a column might be absent, and the next reason is
  // the one nobody listed. The catalog answers the question directly, so the
  // caller's list is free to be a rough over-estimate.
  const catalog = await queryLiveColumnTypes(db, dialect, [tableName]);
  // Keyed by the spelling the CATALOG returned, which is not always the one
  // asked for: MySQL under `lower_case_table_names=1` answers a query for
  // `Dc_Posts` with `dc_posts`, so an exact `.get` misses the very table it
  // just described. That miss is not a harmless one — it lands on the branch
  // below that reports neither nulls nor absences, which is indistinguishable
  // from a clean table and silently withdraws the refusal this function exists
  // to supply.
  //
  // Resolved the way `pushschema-pipeline` resolves the same question, and the
  // folding setting is GIVEN rather than queried, which is sound here for a
  // narrower reason than a blanket listing would allow: the catalog read is
  // filtered on this one name, so every key it can return is a row the SERVER
  // itself matched against the name asked for. Folding among those cannot reach
  // a table the server did not already offer as the answer, while an exact
  // match discards the answer it did offer. Reading the live
  // `lower_case_table_names` instead would cost a round trip on every save and
  // a failure mode when the server declines to report it.
  //
  // Only the TABLE lookup is resolved this way. A column the catalog spells
  // differently falls into `absent`, which refuses — the safe direction for a
  // precondition — so folding it too would trade a false positive for a false
  // negative with no defect reported against it.
  const catalogName = resolveCatalogName(
    indexCatalog(
      [...catalog.keys()],
      (dialect === "mysql"
        ? identifierCaseRules({ dialect, lowerCaseTableNames: 1 })
        : identifierCaseRules({ dialect })
      ).tables
    ),
    tableName
  );
  const live = catalogName === undefined ? undefined : catalog.get(catalogName);
  // No such table: nothing exists to hold a null and nothing can be tightened
  // against it either, so neither set gains a member.
  if (live === undefined) return { holdingNull, absent };

  for (const column of columns) {
    if (!live.has(column)) {
      absent.add(column);
      continue;
    }
    const probe = sql`SELECT 1 FROM ${sql.identifier(tableName)} WHERE ${sql.identifier(column)} IS NULL LIMIT 1`;
    if (await probeReturnsRow(db, dialect, probe)) holdingNull.add(column);
  }
  return { holdingNull, absent };
}

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
 * A relation as the next catalog read finds it again. PostgreSQL's is its `regclass` text in
 * `table` (schema-qualified, and quoted, exactly when its bare name would not resolve to it) and
 * no `schema`; MySQL's is its name in `table` and its database in `schema`, the current database
 * when unset.
 */
export interface RelationRef {
  schema?: string;
  table: string;
}

/** One foreign key referencing a table, as a removal of that table's rows reaches it. */
export interface ReferencingKey {
  /**
   * The referencing table, named the way an unqualified statement reaches it: its bare name when
   * that name resolves to it, else qualified by its schema (PostgreSQL) or database (MySQL).
   */
  child: string;
  /** How the next read finds the referencing table itself, never a same-named one. */
  ref: RelationRef;
  onDelete: "cascade" | "set null" | "set default" | "none";
  /** The referencing table's key columns, in key order. */
  columns: string[];
}

/** PostgreSQL's `confdeltype` codes for the actions that touch the referencing rows. */
const PG_DELETE_ACTIONS: Record<string, ReferencingKey["onDelete"]> = {
  c: "cascade",
  n: "set null",
  d: "set default",
};

/** MySQL's `DELETE_RULE` spellings for the actions that touch the referencing rows. */
const MYSQL_DELETE_ACTIONS: Record<string, ReferencingKey["onDelete"]> = {
  CASCADE: "cascade",
  "SET NULL": "set null",
  "SET DEFAULT": "set default",
};

/**
 * Throws when `ref` resolves to no PostgreSQL relation, so a read through `to_regclass` that
 * would match nothing answers "unreadable" to its caller instead of "none".
 */
async function requirePgRelation(db: unknown, ref: string): Promise<void> {
  const result = (await (db as PgMysqlExecute).execute(
    sql`SELECT to_regclass(${ref}) IS NULL AS missing`
  )) as { rows: { missing: boolean }[] };
  if (result.rows[0]?.missing !== false) {
    throw NextlyError.internal({
      logContext: { reason: "relation not resolved", relation: ref },
    });
  }
}

/**
 * Every foreign key referencing `parent`, with the referencing table it lives on, its ON DELETE
 * action and its columns, read in one pass from the keys themselves.
 *
 * Read by relation identity rather than by name: a referencing table is found again through the
 * ref this returns, so one in another schema (PostgreSQL) or database (MySQL) is never confused
 * with a same-named table the search path or the current database makes visible. On PostgreSQL
 * the keys come straight from `pg_constraint` by OID, the child named by `conrelid::regclass`;
 * on MySQL from `KEY_COLUMN_USAGE` joined to `REFERENTIAL_CONSTRAINTS`, across every database.
 * SQLite applies no cascade during a migration (its runner turns enforcement off) and is not read.
 */
export async function readReferencingKeys(
  db: unknown,
  dialect: "postgresql" | "mysql",
  parent: RelationRef
): Promise<ReferencingKey[]> {
  const keys = new Map<string, ReferencingKey>();
  if (dialect === "postgresql") {
    await requirePgRelation(db, parent.table);
    const result = (await (db as PgMysqlExecute).execute(
      sql`SELECT c.oid::text AS key_id, c.conrelid::regclass::text AS child,
                 c.confdeltype::text AS action, a.attname::text AS column_name
          FROM pg_constraint c
          CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          WHERE c.contype = 'f' AND c.confrelid = to_regclass(${parent.table})
          ORDER BY c.oid, k.ord`
    )) as {
      rows: {
        key_id: string;
        child: string;
        action: string;
        column_name: string;
      }[];
    };
    for (const row of result.rows) {
      const key = keys.get(row.key_id) ?? {
        child: row.child,
        ref: { table: row.child },
        onDelete: PG_DELETE_ACTIONS[row.action] ?? "none",
        columns: [],
      };
      key.columns.push(row.column_name);
      keys.set(row.key_id, key);
    }
    return [...keys.values()];
  }

  const schema =
    parent.schema === undefined ? sql`DATABASE()` : sql`${parent.schema}`;
  const rows = mysqlRows<{
    CONSTRAINT_SCHEMA: string;
    CONSTRAINT_NAME: string;
    TABLE_SCHEMA: string;
    TABLE_NAME: string;
    COLUMN_NAME: string;
    DELETE_RULE: string;
    CURRENT_DB: string | null;
  }>(
    await (db as PgMysqlExecute).execute(
      sql`SELECT k.CONSTRAINT_SCHEMA, k.CONSTRAINT_NAME, k.TABLE_SCHEMA, k.TABLE_NAME,
                 k.COLUMN_NAME, r.DELETE_RULE, DATABASE() AS CURRENT_DB
          FROM information_schema.KEY_COLUMN_USAGE k
          JOIN information_schema.REFERENTIAL_CONSTRAINTS r
            ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
           AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
           AND r.TABLE_NAME = k.TABLE_NAME
          WHERE k.REFERENCED_TABLE_SCHEMA = ${schema}
            AND k.REFERENCED_TABLE_NAME = ${parent.table}
          ORDER BY k.CONSTRAINT_SCHEMA, k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`
    )
  );
  for (const row of rows) {
    const id = `${row.CONSTRAINT_SCHEMA}\u0000${row.TABLE_NAME}\u0000${row.CONSTRAINT_NAME}`;
    // A table in the current database goes by its bare name, any other by its database's too.
    const child =
      row.TABLE_SCHEMA === row.CURRENT_DB
        ? row.TABLE_NAME
        : `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
    const key = keys.get(id) ?? {
      child,
      ref: { schema: row.TABLE_SCHEMA, table: row.TABLE_NAME },
      onDelete: MYSQL_DELETE_ACTIONS[row.DELETE_RULE] ?? "none",
      columns: [],
    };
    key.columns.push(row.COLUMN_NAME);
    keys.set(id, key);
  }
  return [...keys.values()];
}

/**
 * The PostgreSQL functions outside the system catalogs, as `pg_proc` oids: every function but
 * those in `pg_catalog` and `information_schema`, and an installed extension's members
 * (`pg_depend` deptype 'e'), which are the database's own as much as a built-in is.
 */
const PG_USER_FUNCTIONS = sql`
  SELECT p.oid FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg\\_%'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend e
      WHERE e.classid = 'pg_proc'::regclass AND e.objid = p.oid AND e.deptype = 'e'
    )`;

/** Code a table carries that a change reaching it runs (`readHiddenCode`). */
export interface HiddenCode {
  /**
   * Run by a row removed, written or blanked: any trigger (whatever its event, enabled or not), a
   * PostgreSQL rule, or a default, generated column, CHECK, policy or domain CHECK calling a
   * function outside the system catalogs and installed extensions.
   */
  rows: boolean;
  /** Run by PostgreSQL's conversion of a column, which re-checks every row: such a CHECK or domain CHECK. */
  rewrite: boolean;
}

/**
 * What code `table` carries that a change to it runs, which no statement shows and which may
 * delete other data. PostgreSQL reads it through the table's ref (`RelationRef.table`), throwing
 * when the ref does not resolve: the triggers, the rules, and the expressions depending on a user
 * function (`PG_USER_FUNCTIONS`) or an operator one implements, through `pg_depend`. MySQL and
 * SQLite read only triggers: neither lets a default or a CHECK call a stored function.
 */
export async function readHiddenCode(
  db: unknown,
  dialect: SupportedDialect,
  table: string
): Promise<HiddenCode> {
  if (dialect === "postgresql") return readPgHiddenCode(db, table);
  const lower = table.toLowerCase();
  const probe =
    dialect === "mysql"
      ? sql`SELECT 1 FROM information_schema.TRIGGERS
            WHERE EVENT_OBJECT_SCHEMA = DATABASE()
              AND lower(EVENT_OBJECT_TABLE) = ${lower}
            LIMIT 1`
      : sql`SELECT 1 FROM sqlite_master
            WHERE type = 'trigger' AND lower(tbl_name) = ${lower}`;
  return { rows: await probeReturnsRow(db, dialect, probe), rewrite: false };
}

/** `readHiddenCode` on PostgreSQL. */
async function readPgHiddenCode(
  db: unknown,
  table: string
): Promise<HiddenCode> {
  await requirePgRelation(db, table);
  const result = (await (db as PgMysqlExecute).execute(
    sql`WITH rel AS (SELECT to_regclass(${table}) AS id),
      user_fn AS (${PG_USER_FUNCTIONS}),
      user_ref AS (
        SELECT 'pg_proc'::regclass AS classid, oid AS objid FROM user_fn
        UNION ALL
        SELECT 'pg_operator'::regclass, o.oid
        FROM pg_operator o JOIN user_fn f ON f.oid = o.oprcode
      ),
      checks AS (
        SELECT 'pg_constraint'::regclass AS classid, c.oid AS objid
        FROM pg_constraint c JOIN rel ON c.conrelid = rel.id
        WHERE c.contype = 'c'
        UNION ALL
        SELECT 'pg_constraint'::regclass, c.oid
        FROM pg_constraint c
        JOIN pg_attribute a ON a.atttypid = c.contypid
        JOIN rel ON a.attrelid = rel.id
        WHERE c.contype = 'c' AND a.attnum > 0 AND NOT a.attisdropped
      ),
      exprs AS (
        SELECT classid, objid FROM checks
        UNION ALL
        SELECT 'pg_attrdef'::regclass, d.oid
        FROM pg_attrdef d JOIN rel ON d.adrelid = rel.id
        UNION ALL
        SELECT 'pg_policy'::regclass, p.oid
        FROM pg_policy p JOIN rel ON p.polrelid = rel.id
      ),
      calls AS (
        SELECT x.classid, x.objid FROM pg_depend d
        JOIN user_ref u ON u.classid = d.refclassid AND u.objid = d.refobjid
        JOIN exprs x ON x.classid = d.classid AND x.objid = d.objid
      )
      SELECT
        (EXISTS (SELECT 1 FROM pg_trigger t JOIN rel ON t.tgrelid = rel.id
                 WHERE NOT t.tgisinternal)
         OR EXISTS (SELECT 1 FROM pg_rewrite r JOIN rel ON r.ev_class = rel.id
                    WHERE r.rulename <> '_RETURN')
         OR EXISTS (SELECT 1 FROM calls)) AS on_rows,
        EXISTS (SELECT 1 FROM calls c JOIN checks k
                ON k.classid = c.classid AND k.objid = c.objid) AS on_rewrite`
  )) as { rows: { on_rows: boolean; on_rewrite: boolean }[] };
  const row = result.rows[0];
  return { rows: row?.on_rows !== false, rewrite: row?.on_rewrite !== false };
}

/**
 * Every table that inherits from PostgreSQL table `table` (its ref), directly or through another,
 * partitions included: the tables a DELETE or TRUNCATE of it without ONLY also empties. Each comes
 * as its `regclass` text, schema-qualified exactly when its bare name would not resolve to it, so
 * it is both the name and the ref. Throws when `table` does not resolve.
 */
export async function readPgDescendants(
  db: unknown,
  table: string
): Promise<string[]> {
  await requirePgRelation(db, table);
  const result = (await (db as PgMysqlExecute).execute(
    sql`WITH RECURSIVE d(id) AS (
          SELECT i.inhrelid FROM pg_inherits i WHERE i.inhparent = to_regclass(${table})
          UNION
          SELECT i.inhrelid FROM pg_inherits i JOIN d ON i.inhparent = d.id
        )
        SELECT d.id::regclass::text AS name FROM d ORDER BY 1`
  )) as { rows: { name: string }[] };
  return result.rows.map(row => row.name);
}

/**
 * The enabled PostgreSQL event triggers (`pg_event_trigger`, any `evtenabled` but 'D'), by
 * name: code the database runs on DDL commands, which no statement in a migration shows. Other
 * dialects have none. Throws when the catalog cannot be read.
 */
export async function readDdlEventTriggers(
  db: unknown,
  dialect: SupportedDialect
): Promise<string[]> {
  if (dialect !== "postgresql") return [];
  const result = (await (db as PgMysqlExecute).execute(
    sql`SELECT evtname AS name FROM pg_event_trigger
        WHERE evtenabled <> 'D' ORDER BY 1`
  )) as { rows: { name: string }[] };
  return result.rows.map(row => row.name);
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

/** The names of the unique ones among `indexes` (`readIndexUniqueness`). */
export function uniqueIndexNames(
  indexes: ReadonlyMap<string, { unique: boolean }>
): Set<string> {
  return new Set(
    [...indexes].filter(([, index]) => index.unique).map(([name]) => name)
  );
}

/**
 * Each index the table carries, by name, with whether it is unique (`readIndexes`). A name says
 * nothing about what an index enforces, so a caller relying on one being unique asks this.
 */
export async function readIndexUniqueness(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string
): Promise<Map<string, { unique: boolean }>> {
  return new Map(
    (await readIndexes(db, dialect, tableName)).map(index => [
      index.name,
      { unique: index.unique },
    ])
  );
}

/**
 * The columns a UNIQUE index covers on its own, whatever the index is called.
 *
 * An index's name says nothing about what it enforces: one under a unique index's expected name can
 * stand on another column, and a unique index under another name can cover this one. A save that
 * has to know whether a column's values are already held unique, after one MySQL refused part-way
 * say, asks the catalog what each index covers rather than which names it holds. Single-column
 * indexes only, because a unique field is enforced by one; the primary key counts. A partial
 * unique index, or one on an expression or a prefix, does not: it leaves repeats free outside it.
 *
 * Each column comes with the name of the index that covers it, so turning Unique off drops the
 * index that is there rather than one of the names the generator would have used. The name is
 * null where no statement can drop it by name: the primary key, and SQLite's index for an inline
 * `UNIQUE`, which only a table rebuild removes.
 */
export async function readUniqueColumns(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string
): Promise<Map<string, string | null>> {
  const unique = (await readIndexes(db, dialect, tableName)).filter(
    index => index.unique && index.wholeColumns && index.columns.length === 1
  );
  return new Map(
    unique.map(index => [
      index.columns[0],
      index.droppableByName ? index.name : null,
    ])
  );
}

/** An object of the database holding a name an index is about to take. */
export interface NameHolder {
  /** Its name as stored, which on SQLite may differ from the one asked for in letter case. */
  name: string;
  /** What it is: `index`, `table`, `view` and so on. */
  type: string;
  /** The table an index belongs to; null for any other object. */
  table: string | null;
}

/**
 * For each of `names`, an object outside `tableName`'s own indexes that already holds it, where
 * the dialect's index names are shared beyond one table. SQLite keeps one name space for the whole
 * database and compares names without regard to case, so an index under the name on another
 * table, or under the name in other letter case, holds it. PostgreSQL gives an index the name
 * space of every relation in its schema. MySQL names an index per table, so nothing elsewhere can
 * hold one of its names, and the result is empty there. A `CREATE INDEX IF NOT EXISTS` under a held
 * name does nothing, so a caller refuses rather than record an index nothing created.
 */
export async function readNameHoldersElsewhere(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string,
  names: readonly string[]
): Promise<Map<string, NameHolder>> {
  const held = new Map<string, NameHolder>();
  if (dialect === "mysql") return held;
  for (const name of names) {
    const rows =
      dialect === "sqlite"
        ? ((await (db as SqliteAll).all(
            sql`SELECT name, type, CASE WHEN type = 'index' THEN tbl_name END AS tbl
                FROM sqlite_master WHERE name = ${name} COLLATE NOCASE`
          )) as { name: string; type: string; tbl: string | null }[])
        : (
            (await (db as PgMysqlExecute).execute(
              sql`SELECT c.relname AS name,
                    CASE c.relkind WHEN 'i' THEN 'index' WHEN 'r' THEN 'table' WHEN 'v' THEN 'view'
                      WHEN 'S' THEN 'sequence' ELSE 'relation' END AS type,
                    t.relname AS tbl
                  FROM pg_class c
                  JOIN pg_namespace ns ON ns.oid = c.relnamespace
                  LEFT JOIN pg_index i ON i.indexrelid = c.oid
                  LEFT JOIN pg_class t ON t.oid = i.indrelid
                  WHERE ns.nspname = current_schema() AND c.relname = ${name}`
            )) as {
              rows: { name: string; type: string; tbl: string | null }[];
            }
          ).rows;
    // The table's own index under exactly this name is the per-table check's to judge.
    const holder = rows.find(
      row =>
        !(row.type === "index" && row.tbl === tableName && row.name === name)
    );
    if (holder) {
      held.set(name, {
        name: holder.name,
        type: holder.type,
        table: holder.tbl ?? null,
      });
    }
  }
  return held;
}

/**
 * Each index that stands on whole columns, with the columns it covers, by name. A save that has
 * to know whether a column's index already exists, after one MySQL refused part-way say, asks
 * what an index covers: an index under the expected name can stand on another column.
 */
export async function readIndexColumns(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string
): Promise<Map<string, string[]>> {
  return new Map(
    (await readIndexes(db, dialect, tableName))
      .filter(index => index.wholeColumns)
      .map(index => [index.name, index.columns])
  );
}

/** One index of a live table, as the catalog describes it. */
interface LiveIndex {
  name: string;
  columns: string[];
  unique: boolean;
  /**
   * Whether it stands on its columns' whole values for every row: not partial (`WHERE`), not on
   * an expression, not a MySQL prefix, and valid. Only such an index enforces or serves the field
   * as a whole; a unique index over part of the rows leaves the rest free to repeat.
   */
  wholeColumns: boolean;
  /** False for the primary key, and SQLite's index for an inline `UNIQUE`, which only a rebuild removes. */
  droppableByName: boolean;
}

/** A PostgreSQL collation, with the schema that holds it. */
/**
 * MySQL: by lower-cased table name, the lower-cased columns whose character set is not their
 * table's default. A `MODIFY` or `CHANGE` that names no character set gives the column the
 * table's default, converting every stored value, so only a column absent here keeps its values
 * through a type change that widens it. A table read with no such column maps to an empty set.
 */
export async function readMysqlOtherCharsets(
  db: unknown,
  tableNames: readonly string[]
): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>(
    tableNames.map(name => [name.toLowerCase(), new Set<string>()])
  );
  if (tableNames.length === 0) return found;
  const rows = mysqlRows<{ TABLE_NAME: string; COLUMN_NAME: string }>(
    await (db as PgMysqlExecute).execute(
      sql`SELECT c.TABLE_NAME, c.COLUMN_NAME
          FROM information_schema.COLUMNS c
          JOIN information_schema.TABLES t
            ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
          JOIN information_schema.COLLATIONS co
            ON co.COLLATION_NAME = t.TABLE_COLLATION
          WHERE c.TABLE_SCHEMA = DATABASE()
            AND c.TABLE_NAME IN (${sql.join(
              tableNames.map(name => sql`${name}`),
              sql`, `
            )})
            AND c.CHARACTER_SET_NAME IS NOT NULL
            AND c.CHARACTER_SET_NAME <> co.CHARACTER_SET_NAME`
    )
  );
  for (const row of rows) {
    found.get(row.TABLE_NAME.toLowerCase())?.add(row.COLUMN_NAME.toLowerCase());
  }
  return found;
}

export interface PgCollation {
  schema: string;
  name: string;
}

/**
 * The columns of a PostgreSQL table that carry a collation other than their type's default, by
 * name. `ALTER COLUMN ... TYPE` sets the new type's default collation unless the statement names
 * one, so a statement that changes a column's type restates what this reads. Each collation comes
 * with its schema: one outside the search path does not resolve by its name alone, and a
 * same-named one elsewhere on it would be taken instead. Read through `to_regclass`, so the table
 * resolves on the search path as every other read here does.
 */
export async function readPgColumnCollations(
  db: unknown,
  tableName: string
): Promise<Map<string, PgCollation>> {
  const result = (await (db as PgMysqlExecute).execute(
    sql`SELECT a.attname AS column_name, n.nspname AS collation_schema,
               co.collname AS collation_name
        FROM pg_attribute a
        JOIN pg_collation co ON co.oid = a.attcollation
        JOIN pg_namespace n ON n.oid = co.collnamespace
        JOIN pg_type t ON t.oid = a.atttypid
        WHERE a.attrelid = to_regclass(${tableName}) AND a.attnum > 0
          AND NOT a.attisdropped AND a.attcollation <> t.typcollation`
  )) as {
    rows: {
      column_name: string;
      collation_schema: string;
      collation_name: string;
    }[];
  };
  return new Map(
    result.rows.map(row => [
      row.column_name,
      { schema: row.collation_schema, name: row.collation_name },
    ])
  );
}

/** Every index on `tableName`, read once from the catalog of the dialect. */
async function readIndexes(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string
): Promise<LiveIndex[]> {
  if (dialect === "postgresql") return readPgIndexes(db, tableName);
  if (dialect === "mysql") return readMysqlIndexes(db, tableName);
  return readSqliteIndexes(db, tableName);
}

async function readPgIndexes(
  db: unknown,
  tableName: string
): Promise<LiveIndex[]> {
  const result = (await (db as PgMysqlExecute).execute(
    sql`SELECT c.relname AS index_name, a.attname AS column_name, i.indisunique AS is_unique,
          i.indisprimary AS is_primary,
          (i.indpred IS NULL AND i.indexprs IS NULL AND i.indisvalid) AS whole
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = to_regclass(${tableName})`
  )) as {
    rows: {
      index_name: string;
      column_name: string | null;
      is_unique: boolean;
      is_primary: boolean;
      whole: boolean;
    }[];
  };
  const byName = new Map<string, LiveIndex>();
  for (const row of result.rows) {
    const index = byName.get(row.index_name) ?? {
      name: row.index_name,
      columns: [],
      unique: row.is_unique,
      wholeColumns: row.whole,
      droppableByName: !row.is_primary,
    };
    if (row.column_name !== null) index.columns.push(row.column_name);
    byName.set(row.index_name, index);
  }
  return [...byName.values()];
}

async function readMysqlIndexes(
  db: unknown,
  tableName: string
): Promise<LiveIndex[]> {
  const rows = mysqlRows<{
    INDEX_NAME: string;
    COLUMN_NAME: string | null;
    NON_UNIQUE: number | string;
    SUB_PART: number | string | null;
  }>(
    await (db as PgMysqlExecute).execute(
      sql`SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SUB_PART FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${tableName}
          ORDER BY INDEX_NAME, SEQ_IN_INDEX`
    )
  );
  const byName = new Map<string, LiveIndex>();
  for (const row of rows) {
    const index = byName.get(row.INDEX_NAME) ?? {
      name: row.INDEX_NAME,
      columns: [],
      unique: Number(row.NON_UNIQUE) === 0,
      wholeColumns: true,
      droppableByName: row.INDEX_NAME !== "PRIMARY",
    };
    // An expression has no column name, and a prefix keys only part of each value.
    if (row.COLUMN_NAME === null || row.SUB_PART !== null) {
      index.wholeColumns = false;
    } else {
      index.columns.push(row.COLUMN_NAME);
    }
    byName.set(row.INDEX_NAME, index);
  }
  return [...byName.values()];
}

async function readSqliteIndexes(
  db: unknown,
  tableName: string
): Promise<LiveIndex[]> {
  const listed = (await (db as SqliteAll).all(
    sql`PRAGMA index_list(${sql.identifier(tableName)})`
  )) as { name: string; unique: number; origin?: string; partial?: number }[];
  const indexes: LiveIndex[] = [];
  for (const index of listed) {
    const covered = (await (db as SqliteAll).all(
      sql`PRAGMA index_info(${sql.identifier(index.name)})`
    )) as { name: string | null }[];
    indexes.push({
      name: index.name,
      columns: covered.flatMap(c => (c.name === null ? [] : [c.name])),
      unique: Number(index.unique) === 1,
      // An expression has no column name.
      wholeColumns:
        Number(index.partial ?? 0) === 0 && covered.every(c => c.name !== null),
      // `c` is an index made by CREATE INDEX; the others come with the table's own definition.
      droppableByName: index.origin === "c",
    });
  }
  return indexes;
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
