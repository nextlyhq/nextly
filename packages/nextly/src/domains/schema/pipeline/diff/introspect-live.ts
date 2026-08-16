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

/**
 * Put every table's indexes in a stable order.
 *
 * The order a DATABASE reports indexes in is not a property of the schema, and
 * each dialect answers differently — SQLite's `PRAGMA index_list` walks them in
 * reverse creation order, so which index was created first leaks into the
 * snapshot. That makes two snapshots of the SAME schema compare unequal:
 * introspect a table, write its indexes out in the order read, rebuild from
 * that SQL and introspect again, and the list comes back reversed. Sorting by
 * name is what makes a snapshot describe the schema rather than its history.
 *
 * Index COLUMNS keep their order — for a composite index that order IS the
 * index, and every dialect query above already reads them by position.
 */
function normalizeIndexOrder(snapshot: NextlySchemaSnapshot): void {
  for (const t of snapshot.tables) {
    t.indexes?.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
}

/**
 * The modifier a DECLARED type string already carries — `varchar(255)` gives `255`.
 *
 * Right for MySQL and SQLite, whose introspection reports the declaration itself
 * (`COLUMN_TYPE`, `PRAGMA table_info.type`). Reading their information_schema
 * width columns instead would INVENT modifiers: measured on MySQL 8, a `TEXT`
 * column reports `CHARACTER_MAXIMUM_LENGTH` 65535 while its `COLUMN_TYPE` is a
 * bare `text`, and an `INT` reports precision 10.
 */
function modifierFromDeclaredType(type: string): string | undefined {
  const match = /\(([^)]*)\)/.exec(type);
  const inner = match?.[1];
  return inner === undefined ? undefined : inner.replace(/\s+/g, "");
}

/**
 * PostgreSQL's modifier, reconstructed — it has no `COLUMN_TYPE` equivalent, and
 * `udt_name` never carries one.
 *
 * 🔴 GATED BY TYPE, because `information_schema` reports a precision for types
 * that were never declared with one. Measured on PostgreSQL 17: `integer` reports
 * numeric_precision 32, `double precision` reports 53. Those are properties of the
 * storage, not of the declaration — nobody writes `INTEGER(32)` — so copying them
 * would compare a fabricated modifier against a generator that emits none, and
 * refuse healthy tables.
 *
 * Only the two families that genuinely take a modifier are read: character types
 * carry a length, exact-numeric types carry precision and scale.
 */
function pgTypeModifier(row: PgRow): string | undefined {
  // 🔴 Tested for a NUMBER rather than against null. `information_schema` yields null for a type
  // with no modifier, but a row that simply lacks the key — an older snapshot, a driver that omits
  // nulls, a hand-built row — is `undefined`, and `undefined !== null` is true. That branch then
  // stringifies to the literal "undefined" and records it as a width, which is a fabricated
  // modifier of exactly the kind the gating below exists to prevent.
  if (typeof row.character_maximum_length === "number") {
    return String(row.character_maximum_length);
  }
  const exactNumeric = row.udt_name === "numeric" || row.udt_name === "decimal";
  if (exactNumeric && typeof row.numeric_precision === "number") {
    return typeof row.numeric_scale === "number"
      ? `${row.numeric_precision},${row.numeric_scale}`
      : String(row.numeric_precision);
  }
  return undefined;
}

interface PgRow {
  table_name: string;
  column_name: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  owned_sequence_default: boolean;
  is_primary_key: boolean;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

interface MysqlRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: "YES" | "NO";
  COLUMN_DEFAULT: string | null;
  DATA_TYPE: string;
  EXTRA: string;
}

interface MysqlPrimaryKeyRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
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
    // `owned_sequence_default` answers whether the default is the sequence
    // this column owns, which is what `serial` materialises and the only
    // sequence default the diff may treat as no default at all.
    // `pg_get_serial_sequence` names the owned sequence (NULL when there is
    // none); the substring pulls the sequence the default actually draws
    // from. Both sides are cast to regclass so the comparison is by identity
    // rather than by spelling — the default renders the name relative to the
    // search path while the function returns it schema-qualified. Anything
    // that is not exactly a `nextval()` call yields NULL from the substring
    // and so falls to false, which is the safe direction: a default the diff
    // does not recognise is reported, never swallowed.
    // `is_primary_key` comes from `pg_index.indisprimary` rather than
    // `information_schema.table_constraints`, so it needs no second round trip
    // and reports the same key the index query deliberately excludes. A live
    // snapshot without it renders a key-less `CREATE TABLE` in any statement
    // generated from it, which is how an adopted database rebuilt elsewhere
    // ended up with no primary keys at all.
    const result = (await dbTyped.execute(
      sql`SELECT c.table_name, c.column_name, c.udt_name, c.is_nullable,
                 c.column_default,
                 c.character_maximum_length, c.numeric_precision, c.numeric_scale,
                 EXISTS (
                   SELECT 1
                   FROM pg_index i
                   JOIN pg_class t ON t.oid = i.indrelid
                   JOIN pg_namespace n ON n.oid = t.relnamespace
                   JOIN pg_attribute a
                     ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
                   WHERE i.indisprimary
                     AND n.nspname = c.table_schema
                     AND t.relname = c.table_name
                     AND a.attname = c.column_name
                 ) AS is_primary_key,
                 COALESCE(
                   substring(
                     c.column_default from '^nextval[(]''(.+)''::regclass[)]$'
                   )::regclass
                     = pg_get_serial_sequence(
                         format('%I.%I', c.table_schema, c.table_name),
                         c.column_name
                       )::regclass,
                   false
                 ) AS owned_sequence_default
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name IN (${tableNamesIn})
          ORDER BY c.table_name, c.ordinal_position`
    )) as { rows: PgRow[] };
    const snapshot = buildSnapshotFromPgRows(result.rows);
    // Index query: join pg_index/pg_class/pg_attribute. Exclude primary keys
    // (indisprimary) and partial indexes (indpred). Expression indexes yield no
    // pg_attribute row and are naturally excluded.
    //
    // Scoped to `public` like the column query above. `pg_class.relname` is
    // unique per schema, not per database, so without the namespace join a
    // same-named table in another schema contributes its indexes to these rows
    // and `attachIndexes` groups them under the same name — reporting indexes
    // that are not on the table being introspected, and masking the absence of
    // ones that should be.
    const idxResult = (await dbTyped.execute(
      sql`SELECT t.relname AS table, i.relname AS index, ix.indisunique AS unique,
                 a.attname AS column, array_position(ix.indkey, a.attnum) AS ord
          FROM pg_class t
          JOIN pg_namespace n ON n.oid = t.relnamespace
          JOIN pg_index ix ON ix.indrelid = t.oid
          JOIN pg_class i ON i.oid = ix.indexrelid
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
          WHERE n.nspname = 'public'
            AND t.relname IN (${tableNamesIn})
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
    normalizeIndexOrder(snapshot);
    return snapshot;
  }

  if (dialect === "mysql") {
    const dbTyped = db as PgMysqlExecute;
    // mysql2's execute returns a [rows, fieldPackets] tuple; drizzle-orm/mysql2
    // sometimes wraps it. Handle both shapes defensively.
    const result = (await dbTyped.execute(
      sql`SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
                 DATA_TYPE, EXTRA
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
    // The key comes from the PRIMARY index rather than `COLUMN_KEY`, which
    // does not mean what its name suggests: a table with no primary key but a
    // NOT NULL UNIQUE index reports `PRI` for that column, because InnoDB
    // promotes such an index to the clustered key. Trusting it would mark
    // something like `slug` as the primary key, hiding a table that genuinely
    // has none and rebuilding it elsewhere with the wrong key. Verified
    // against MySQL 8: `STATISTICS` shows only the `slug` index, no `PRIMARY`,
    // while `COLUMN_KEY` still says `PRI`.
    const pkRaw = (await dbTyped.execute(
      sql`SELECT TABLE_NAME, COLUMN_NAME
          FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME IN (${tableNamesIn})
            AND INDEX_NAME = 'PRIMARY'`
    )) as MysqlPrimaryKeyRow[] | [MysqlPrimaryKeyRow[], unknown];
    const pkRows: MysqlPrimaryKeyRow[] =
      Array.isArray(pkRaw) &&
      pkRaw.length > 0 &&
      Array.isArray((pkRaw as unknown[])[0])
        ? (pkRaw as [MysqlPrimaryKeyRow[], unknown])[0]
        : (pkRaw as MysqlPrimaryKeyRow[]);
    const primaryKeyColumns = new Set(
      pkRows.map(r => `${r.TABLE_NAME}.${r.COLUMN_NAME}`)
    );

    const snapshot = buildSnapshotFromMysqlRows(rows, primaryKeyColumns);
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
    normalizeIndexOrder(snapshot);
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
          // SQLite stores notnull as 0/1 integer. Reported as stored: a
          // TEXT PRIMARY KEY really is nullable here (only INTEGER PRIMARY KEY
          // is implicitly NOT NULL), and the snapshot must describe the
          // database. Whether requiring such a column is safe is decided from
          // the data, in resolve-safe-nullability.ts.
          nullable: r.notnull === 0,
          // `pk` is 0 for an ordinary column and the 1-based position within
          // the key otherwise, so any non-zero value means this column is part
          // of it. PRAGMA has always returned this; nothing read it.
          ...(r.pk > 0 ? { primaryKey: true as const } : {}),
          // dflt_value can be string, number, null, or undefined.
          // Coerce primitives to string; treat anything non-primitive as
          // missing (defensive - SQLite never returns object defaults).
          default: sqliteDefaultExpression(r.dflt_value),
          // PRAGMA reports the DECLARED type, so any modifier is already in it.
          ...(modifierFromDeclaredType(r.type) !== undefined
            ? { typeModifier: modifierFromDeclaredType(r.type) }
            : {}),
        })
      ),
    });
  }
  const snapshot: NextlySchemaSnapshot = { tables };
  normalizeIndexOrder(snapshot);
  return snapshot;
}

/**
 * Bare keywords SQLite accepts as a default without parentheses.
 *
 * Everything else that is not a literal is an expression, and SQLite requires
 * one to be parenthesised.
 */
const SQLITE_BARE_DEFAULTS = new Set([
  "null",
  "true",
  "false",
  "current_time",
  "current_date",
  "current_timestamp",
]);

/**
 * A SQLite default as it must appear in DDL.
 *
 * `PRAGMA table_info` reports an expression default with its parentheses
 * STRIPPED — a column declared `DEFAULT (strftime('%s','now'))` comes back as
 * `strftime('%s', 'now')` — and SQLite refuses that same text without them
 * (`near "(": syntax error`). Recorded verbatim, a snapshot taken from a live
 * SQLite database produces a `CREATE TABLE` that cannot be applied anywhere,
 * including back to the database it came from.
 *
 * String literals, numbers and the bare keywords are already valid as written
 * and must NOT be wrapped, since parenthesising them would change a literal
 * into an expression for no reason.
 */
function sqliteDefaultExpression(value: unknown): string | undefined {
  const text = stringifyDefault(value);
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (trimmed === "") return text;
  // Already parenthesised, a quoted literal, a blob literal, or a number.
  if (trimmed.startsWith("(")) return text;
  if (trimmed.startsWith("'") || trimmed.startsWith('"')) return text;
  if (/^[xX]'/.test(trimmed)) return text;
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return text;
  if (SQLITE_BARE_DEFAULTS.has(trimmed.toLowerCase())) return text;
  return `(${trimmed})`;
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
    const column: ColumnSpec = {
      name: r.column_name,
      type: r.udt_name,
      nullable: r.is_nullable === "YES",
      default: r.column_default ?? undefined,
    };
    // Recorded only when true, so a snapshot carries the marker rather than a
    // false on every column that has no sequence at all.
    if (r.owned_sequence_default === true) column.ownedSequenceDefault = true;
    // Same convention for the key: present when it is one, absent otherwise,
    // so a snapshot taken before this reads the same as one where the column
    // is genuinely not part of the key.
    if (r.is_primary_key === true) column.primaryKey = true;
    const pgModifier = pgTypeModifier(r);
    if (pgModifier !== undefined) column.typeModifier = pgModifier;
    cols.push(column);
  }
  return {
    tables: [...byTable.entries()].map(
      ([name, columns]): TableSpec => ({ name, columns })
    ),
  };
}

/** MySQL types whose default is reported as a bare number, not a literal. */
const MYSQL_NUMERIC_TYPES = new Set([
  "tinyint",
  "smallint",
  "mediumint",
  "int",
  "integer",
  "bigint",
  "decimal",
  "numeric",
  "float",
  "double",
  "real",
]);

/**
 * A MySQL default as it must appear in DDL.
 *
 * MySQL is the odd one out. PostgreSQL reports `'draft'::character varying`
 * and SQLite reports `'draft'`, both already quoted; MySQL's
 * `information_schema.COLUMN_DEFAULT` strips the quotes and reports `draft`.
 * Recorded verbatim, a snapshot then renders `DEFAULT draft`, which the server
 * reads as an identifier and refuses — so a schema generated from a live MySQL
 * snapshot could not be applied anywhere.
 *
 * `EXTRA` is what separates the two cases: an expression default (
 * `CURRENT_TIMESTAMP`, `json_array()`) carries `DEFAULT_GENERATED` and must be
 * left alone, while everything else is a literal. Numeric types need no quotes
 * either, and quoting them would turn a number into a string.
 */
function mysqlDefaultExpression(row: MysqlRow): string | undefined {
  const value = row.COLUMN_DEFAULT;
  if (value === null || value === undefined) return undefined;
  // An expression is already valid DDL as written.
  if ((row.EXTRA ?? "").toUpperCase().includes("DEFAULT_GENERATED")) {
    return value;
  }
  if (MYSQL_NUMERIC_TYPES.has((row.DATA_TYPE ?? "").toLowerCase())) {
    return value;
  }
  // A literal. Both the backslash and the quote have to be escaped, and the
  // backslash first: under MySQL's default sql_mode a backslash introduces an
  // escape sequence, so a default of `a\nb` re-emitted with only the quote
  // handled would store a newline instead of the two characters it had.
  const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "''");
  return `'${escaped}'`;
}

function buildSnapshotFromMysqlRows(
  rows: MysqlRow[],
  primaryKeyColumns: ReadonlySet<string>
): NextlySchemaSnapshot {
  const byTable = new Map<string, ColumnSpec[]>();
  for (const r of rows) {
    let cols = byTable.get(r.TABLE_NAME);
    if (!cols) {
      cols = [];
      byTable.set(r.TABLE_NAME, cols);
    }
    const column: ColumnSpec = {
      name: r.COLUMN_NAME,
      type: r.COLUMN_TYPE,
      nullable: r.IS_NULLABLE === "YES",
      default: mysqlDefaultExpression(r),
    };
    if (primaryKeyColumns.has(`${r.TABLE_NAME}.${r.COLUMN_NAME}`)) {
      column.primaryKey = true;
    }
    const myModifier = modifierFromDeclaredType(r.COLUMN_TYPE);
    if (myModifier !== undefined) column.typeModifier = myModifier;
    cols.push(column);
  }
  return {
    tables: [...byTable.entries()].map(
      ([name, columns]): TableSpec => ({ name, columns })
    ),
  };
}
