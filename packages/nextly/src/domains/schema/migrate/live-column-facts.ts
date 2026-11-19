/**
 * What the live database says of a column that a schema snapshot does not record, for judging
 * whether a pending file may be recorded applied without running (`proveStatements`).
 *
 * A snapshot records a column's type, whether it is nullable and its default. Two things a file's
 * statement decides are outside that:
 *
 * - MySQL's `MODIFY` and `CHANGE` restate a column's whole definition, so a run of one puts back
 *   every setting it leaves out: the column's own character set and collation, its comment, its
 *   visibility, `ON UPDATE`, `AUTO_INCREMENT`, a generated column's expression, a geometry
 *   column's spatial reference. A column already at the statement's type can still hold any of
 *   them (`untrackedSettings`). An NDB table's column format and storage are not in
 *   `information_schema.COLUMNS`: such a table's settings are reported as not readable
 *   (`settingsReadable`), and nothing is assumed of them.
 * - A key the database assigns (`serial`, an identity column, `AUTO_INCREMENT`) reads as its
 *   storage type, so a table made by hand with a plain integer key compares equal to one whose
 *   key the database assigns (`generatesKey`), and an identity column reads the same in either
 *   of its modes (`identityMode`).
 *
 * A snapshot also records a constraint's and an index's name and columns, and not whether a MySQL
 * check is enforced (`checkEnforced`), how a PostgreSQL foreign key defers its check
 * (`keyDeferrability`), an index's method and key order (`indexShape`), or a SQLite table's
 * AUTOINCREMENT counter (`counterCovers`).
 *
 * Read-only. Three queries on PostgreSQL; on MySQL three, and two more that ask whether the
 * catalog has a column another server of the dialect lacks; on SQLite up to four small ones for
 * each table.
 *
 * @module domains/schema/migrate/live-column-facts
 */
import { sql, type SQL } from "drizzle-orm";

import type { SupportedDialect } from "../../../database/schema-registry";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { PG_CLASS_IS_THE_RELATION_THE_WRITES_HIT } from "../pipeline/pg-visible-relation";

/** The column facts a proof asks for. Names are compared without regard to case. */
export interface LiveColumnFacts {
  /**
   * The settings a MySQL column holds that a `MODIFY` or `CHANGE` naming only its type,
   * nullability and default would put back, each as a word a person can look for
   * (`COLLATE utf8mb4_bin`, `COMMENT`). None on PostgreSQL and SQLite, which restate no column.
   */
  untrackedSettings(table: string, column: string): readonly string[];
  /**
   * Whether the database assigns the column's value: on PostgreSQL a default over the sequence the
   * column owns or an identity column, on MySQL `AUTO_INCREMENT`. Not read on SQLite, where an
   * `INTEGER PRIMARY KEY` is the rowid and no declaration decides it.
   */
  generatesKey(table: string, column: string): boolean;
  /**
   * A PostgreSQL identity column's mode: `always` refuses a written value unless overridden,
   * `by-default` takes it. Undefined for any other column, a serial one included.
   */
  identityMode(
    table: string,
    column: string
  ): "always" | "by-default" | undefined;
  /**
   * Whether `untrackedSettings` reads everything a restatement of the table's columns would put
   * back. False for a MySQL table the read was not asked for, and for one whose engine keeps
   * column attributes the catalog read here does not report (NDB's `COLUMN_FORMAT` and
   * `STORAGE`): nothing then shows what a column holds, and an empty answer is not "none".
   */
  settingsReadable(table: string): boolean;
  /**
   * Whether a MySQL check constraint is enforced: false for one made or altered `NOT ENFORCED`,
   * which is there and checks nothing. Undefined for a check the read did not find.
   */
  checkEnforced(table: string, name: string): boolean | undefined;
  /**
   * How a PostgreSQL foreign key defers its check: `not` deferrable, deferrable and checked at
   * once (`immediate`), or `deferred` to the end of the transaction. Undefined for a key the read
   * did not find, and on MySQL, which has no deferrable keys, and SQLite, whose keys keep it only
   * in the table's stored text, which is not read.
   */
  keyDeferrability(
    table: string,
    name: string
  ): "not" | "immediate" | "deferred" | undefined;
  /**
   * Whether an index is a plain one: built by the dialect's default method, every key ascending
   * with the default place for NULLs. `other` for one that is not, undefined for one the read did
   * not find. A snapshot records an index's columns and nothing of this.
   */
  indexShape(name: string, table: string): "plain" | "other" | undefined;
  /**
   * Whether a SQLite table's AUTOINCREMENT counter covers its rows, so no key the table used is
   * given out again: the table is declared AUTOINCREMENT, and its counter is at least its highest
   * key, or it has no counter yet and no rows. False for any other table, one not read included.
   */
  counterCovers(table: string): boolean;
}

/** A connection that runs a query and answers its rows, as PostgreSQL and MySQL drivers do. */
interface QueryRunner {
  execute(query: unknown): Promise<unknown>;
}

/** A key for a column within a table, lower-cased. */
const keyOf = (table: string, column: string): string =>
  `${table.toLowerCase()}\u0000${column.toLowerCase()}`;

/**
 * The rows of an `execute` result: PostgreSQL answers `{ rows }`, mysql2 `[rows, fields]`, and a
 * test double may answer the rows alone.
 */
function rowsOf(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) {
    const first: unknown = raw[0];
    return (Array.isArray(first) ? first : raw) as Array<
      Record<string, unknown>
    >;
  }
  const rows = (raw as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

/** One MySQL column's row of `information_schema.COLUMNS`, with its table's collation. */
interface MysqlColumnRow {
  collation: unknown;
  table_collation: unknown;
  comment: unknown;
  extra: unknown;
  generated: unknown;
  /** The spatial reference a geometry column is held to, where it has one. */
  srid: unknown;
}

/**
 * The settings of one MySQL column a plain restatement would put back. A column's collation is its
 * own only where it differs from its table's: a restatement naming none gives the table's.
 */
function mysqlUntrackedSettings(row: MysqlColumnRow): string[] {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const extra = text(row.extra).toLowerCase();
  const collation = text(row.collation);
  // Each setting with whether the column holds it, in the order a definition states them.
  const held: Array<[boolean, string]> = [
    [
      collation !== "" && collation !== text(row.table_collation),
      `COLLATE ${collation}`,
    ],
    [text(row.generated) !== "", "GENERATED"],
    [extra.includes("auto_increment"), "AUTO_INCREMENT"],
    [extra.includes("on update"), "ON UPDATE"],
    [extra.includes("invisible"), "INVISIBLE"],
    [row.srid !== null && row.srid !== undefined, "SRID"],
    [text(row.comment) !== "", "COMMENT"],
  ];
  return [
    ...held.filter(([holds]) => holds).map(([, word]) => word),
    ...unknownFlags(extra),
  ];
}

/**
 * The flags `EXTRA` reports of a column that this read knows: the ones named above, and the ones
 * that say only how a default or a generated column is kept (`GENERATION_EXPRESSION` and the
 * snapshot's default say the rest).
 */
const KNOWN_FLAGS: readonly RegExp[] = [
  /on update \S+/g,
  /default_generated/g,
  /auto_increment/g,
  /(?:virtual|stored) generated/g,
  /invisible/g,
];

/**
 * What `EXTRA` reports beyond the flags known here, as one word to look for (`NOT SECONDARY`,
 * which another engine's server reports): a plain restatement would take it off like any other
 * setting, so it is named and not passed over. None on a server that reports only known flags.
 */
function unknownFlags(extra: string): string[] {
  const rest = KNOWN_FLAGS.reduce(
    (left, flag) => left.replace(flag, " "),
    extra
  )
    .replace(/\s+/g, " ")
    .trim();
  return rest === "" ? [] : [rest.toUpperCase()];
}

/**
 * MySQL engines whose columns carry attributes `information_schema.COLUMNS` does not report: NDB's
 * column format and storage, which a restatement resets like any other setting.
 */
const ENGINES_KEEPING_MORE = new Set(["ndbcluster", "ndb"]);

/** Whether this server's `information_schema.COLUMNS` has `SRS_ID`, which MySQL's alone has. */
async function mysqlCatalogHasSrid(runner: QueryRunner): Promise<boolean> {
  const [row] = rowsOf(
    await runner.execute(
      sql`SELECT COUNT(*) AS found
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = 'information_schema'
            AND TABLE_NAME = 'COLUMNS'
            AND COLUMN_NAME = 'SRS_ID'`
    )
  );
  return Number(row?.found ?? 0) > 0;
}

/**
 * Whether this server's `information_schema.TABLE_CONSTRAINTS` has `ENFORCED`: MySQL's has, and
 * a server of the same dialect without it (MariaDB, which enforces every check) refuses a query
 * naming it.
 */
async function mysqlCatalogHasEnforced(runner: QueryRunner): Promise<boolean> {
  const [row] = rowsOf(
    await runner.execute(
      sql`SELECT COUNT(*) AS found
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = 'information_schema'
            AND TABLE_NAME = 'TABLE_CONSTRAINTS'
            AND COLUMN_NAME = 'ENFORCED'`
    )
  );
  return Number(row?.found ?? 0) > 0;
}

/** What the reads gather, keyed by `keyOf` (columns) or the lower-cased table name. */
interface GatheredFacts {
  settings: Map<string, readonly string[]>;
  generated: Set<string>;
  identities: Map<string, "always" | "by-default">;
  unreadable: Set<string>;
  /** Each check read, with whether it is enforced. */
  enforcement: Map<string, boolean>;
  deferrability: Map<string, "not" | "immediate" | "deferred">;
  indexShapes: Map<string, "plain" | "other">;
  /** Each SQLite table read, with whether its counter covers its rows. */
  counters: Map<string, boolean>;
}

/** The rows of a read that name a table and an object on it, the others left out. */
function namedRows(
  rows: ReadonlyArray<Record<string, unknown>>
): Array<Record<string, unknown> & { table: string; name: string }> {
  return rows.filter(
    (row): row is Record<string, unknown> & { table: string; name: string } =>
      typeof row.table === "string" && typeof row.name === "string"
  );
}

/** Whether a catalog answers yes: PostgreSQL a boolean, MySQL and SQLite 1, a number or a text. */
const yes = (value: unknown): boolean =>
  value === true || Number(value) > 0 || value === "t";

/** PostgreSQL's foreign keys of the tables, each with how it defers its check. */
async function gatherPostgresKeys(
  runner: QueryRunner,
  namesIn: SQL,
  facts: GatheredFacts
): Promise<void> {
  const rows = rowsOf(
    await runner.execute(
      sql`SELECT t.relname AS "table", c.conname AS name,
                 c.condeferrable AS deferrable, c.condeferred AS deferred
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE ${PG_CLASS_IS_THE_RELATION_THE_WRITES_HIT}
            AND t.relname IN (${namesIn})
            AND c.contype = 'f'`
    )
  );
  for (const row of namedRows(rows)) {
    const immediate = yes(row.deferrable) ? "immediate" : "not";
    facts.deferrability.set(
      keyOf(row.table, row.name),
      yes(row.deferred) ? "deferred" : immediate
    );
  }
}

/**
 * PostgreSQL's indexes of the tables: plain where built as a B-tree with no key descending or
 * with its NULLs first (`indoption` is 0 for a key in the default order).
 */
async function gatherPostgresIndexes(
  runner: QueryRunner,
  namesIn: SQL,
  facts: GatheredFacts
): Promise<void> {
  const rows = rowsOf(
    await runner.execute(
      sql`SELECT t.relname AS "table", i.relname AS name,
                 (am.amname <> 'btree' OR EXISTS (
                   SELECT 1 FROM unnest(ix.indoption::int2[]) AS o WHERE o <> 0
                 )) AS other
          FROM pg_index ix
          JOIN pg_class i ON i.oid = ix.indexrelid
          JOIN pg_class t ON t.oid = ix.indrelid
          JOIN pg_am am ON am.oid = i.relam
          WHERE ${PG_CLASS_IS_THE_RELATION_THE_WRITES_HIT}
            AND t.relname IN (${namesIn})`
    )
  );
  for (const row of namedRows(rows)) {
    facts.indexShapes.set(
      keyOf(row.table, row.name),
      yes(row.other) ? "other" : "plain"
    );
  }
}

/** MySQL's check constraints of the tables, each with whether it is enforced. */
async function gatherMysqlChecks(
  runner: QueryRunner,
  namesIn: SQL,
  facts: GatheredFacts
): Promise<void> {
  // A server without the column enforces every check it holds.
  const enforced = (await mysqlCatalogHasEnforced(runner))
    ? sql`tc.ENFORCED <> 'NO'`
    : sql`1`;
  const rows = rowsOf(
    await runner.execute(
      sql`SELECT tc.TABLE_NAME AS \`table\`, tc.CONSTRAINT_NAME AS name,
                 ${enforced} AS enforced
          FROM information_schema.TABLE_CONSTRAINTS tc
          WHERE tc.TABLE_SCHEMA = DATABASE()
            AND tc.TABLE_NAME IN (${namesIn})
            AND tc.CONSTRAINT_TYPE = 'CHECK'`
    )
  );
  for (const row of namedRows(rows)) {
    facts.enforcement.set(keyOf(row.table, row.name), yes(row.enforced));
  }
}

/**
 * MySQL's indexes of the tables: plain where a B-tree with no key descending (`COLLATION` is `D`
 * for one that is).
 */
async function gatherMysqlIndexes(
  runner: QueryRunner,
  namesIn: SQL,
  facts: GatheredFacts
): Promise<void> {
  const rows = rowsOf(
    await runner.execute(
      sql`SELECT s.TABLE_NAME AS \`table\`, s.INDEX_NAME AS name,
                 MAX(s.INDEX_TYPE <> 'BTREE' OR COALESCE(s.COLLATION, 'A') = 'D') AS other
          FROM information_schema.STATISTICS s
          WHERE s.TABLE_SCHEMA = DATABASE()
            AND s.TABLE_NAME IN (${namesIn})
          GROUP BY s.TABLE_NAME, s.INDEX_NAME`
    )
  );
  for (const row of namedRows(rows)) {
    facts.indexShapes.set(
      keyOf(row.table, row.name),
      yes(row.other) ? "other" : "plain"
    );
  }
}

/** A SQLite connection, which answers a query's rows from `all`. */
interface SqliteReader {
  all(query: unknown): unknown[] | Promise<unknown[]>;
}

/** The rows a SQLite query answers, each as a record. */
async function sqliteRows(
  db: SqliteReader,
  query: SQL
): Promise<Array<Record<string, unknown>>> {
  return (await db.all(query)) as Array<Record<string, unknown>>;
}

/** One SQLite table's indexes: plain where no key is descending. SQLite has one method. */
async function gatherSqliteIndexes(
  db: SqliteReader,
  table: string,
  facts: GatheredFacts
): Promise<void> {
  const rows = await sqliteRows(
    db,
    sql`SELECT il.name AS name, MAX(ii."desc") AS other
        FROM pragma_index_list(${table}) il
        JOIN pragma_index_xinfo(il.name) ii
        WHERE ii.key = 1
        GROUP BY il.name`
  );
  for (const row of rows) {
    if (typeof row.name !== "string") continue;
    facts.indexShapes.set(
      keyOf(table, row.name),
      yes(row.other) ? "other" : "plain"
    );
  }
}

/**
 * Whether one SQLite table's AUTOINCREMENT counter covers its rows (`counterCovers`). The counter
 * and the highest key are read only for a table declared AUTOINCREMENT: `sqlite_sequence` exists
 * only once such a table does, and only such a table is sure to have a rowid.
 */
async function sqliteCounterCovers(
  db: SqliteReader,
  table: string
): Promise<boolean> {
  const [declared] = await sqliteRows(
    db,
    sql`SELECT instr(upper(sql), 'AUTOINCREMENT') > 0 AS declared
        FROM sqlite_master WHERE type = 'table' AND name = ${table}`
  );
  if (!yes(declared?.declared)) return false;
  const [counter] = await sqliteRows(
    db,
    sql`SELECT seq FROM sqlite_sequence WHERE name = ${table}`
  );
  const [top] = await sqliteRows(
    db,
    sql`SELECT MAX(rowid) AS top FROM ${sql.identifier(table)}`
  );
  const highest = top?.top;
  // No counter yet: SQLite makes it at the first insert, so the table must hold no row.
  if (counter === undefined) return highest === null || highest === undefined;
  return Number(counter.seq) >= Number(highest ?? 0);
}

/** SQLite's indexes and counters of the tables, one table at a time. */
async function gatherSqlite(
  db: SqliteReader,
  tableNames: readonly string[],
  facts: GatheredFacts
): Promise<void> {
  for (const table of tableNames) {
    await gatherSqliteIndexes(db, table, facts);
    facts.counters.set(
      table.toLowerCase(),
      await sqliteCounterCovers(db, table)
    );
  }
}

/** What is read on PostgreSQL and on MySQL, each read given the tables as one list. */
const GATHERERS = {
  postgresql: [
    gatherPostgresIdentities,
    gatherPostgresKeys,
    gatherPostgresIndexes,
  ],
  mysql: [gatherMysqlColumns, gatherMysqlChecks, gatherMysqlIndexes],
} as const;

/** PostgreSQL's identity columns of the tables, each with its mode. */
async function gatherPostgresIdentities(
  runner: QueryRunner,
  namesIn: SQL,
  facts: GatheredFacts
): Promise<void> {
  const rows = rowsOf(
    await runner.execute(
      sql`SELECT t.relname AS "table", a.attname AS "column",
                 a.attidentity AS identity
          FROM pg_attribute a
          JOIN pg_class t ON t.oid = a.attrelid
          WHERE ${PG_CLASS_IS_THE_RELATION_THE_WRITES_HIT}
            AND t.relname IN (${namesIn})
            AND a.attnum > 0
            AND NOT a.attisdropped
            AND a.attidentity <> ''`
    )
  );
  for (const { table, column, identity } of rows) {
    if (typeof table !== "string" || typeof column !== "string") continue;
    facts.generated.add(keyOf(table, column));
    // `a` is GENERATED ALWAYS, `d` GENERATED BY DEFAULT.
    facts.identities.set(
      keyOf(table, column),
      identity === "a" ? "always" : "by-default"
    );
  }
}

/** MySQL's columns of the tables: what each keeps, which the database assigns, and the engine. */
async function gatherMysqlColumns(
  runner: QueryRunner,
  namesIn: SQL,
  facts: GatheredFacts
): Promise<void> {
  // `SRS_ID` is MySQL's column: a server of the same dialect without it (MariaDB) refuses a
  // query naming it, so it is read only where the catalog has it.
  const srid = (await mysqlCatalogHasSrid(runner)) ? sql`c.SRS_ID` : sql`NULL`;
  const rows = rowsOf(
    await runner.execute(
      sql`SELECT c.TABLE_NAME AS \`table\`, c.COLUMN_NAME AS \`column\`,
                 c.COLLATION_NAME AS collation,
                 t.TABLE_COLLATION AS table_collation,
                 t.ENGINE AS engine,
                 c.COLUMN_COMMENT AS comment, c.EXTRA AS extra,
                 c.GENERATION_EXPRESSION AS \`generated\`,
                 ${srid} AS srid
          FROM information_schema.COLUMNS c
          JOIN information_schema.TABLES t
            ON t.TABLE_SCHEMA = c.TABLE_SCHEMA
           AND t.TABLE_NAME = c.TABLE_NAME
          WHERE c.TABLE_SCHEMA = DATABASE()
            AND c.TABLE_NAME IN (${namesIn})`
    )
  );
  for (const row of rows) {
    const { table, column } = row;
    if (typeof table !== "string" || typeof column !== "string") continue;
    if (ENGINES_KEEPING_MORE.has(String(row.engine).toLowerCase())) {
      facts.unreadable.add(table.toLowerCase());
    }
    const kept = mysqlUntrackedSettings(row as unknown as MysqlColumnRow);
    if (kept.length > 0) facts.settings.set(keyOf(table, column), kept);
    if (kept.includes("AUTO_INCREMENT")) {
      facts.generated.add(keyOf(table, column));
    }
  }
}

/** The columns the introspection already records as defaulting to a sequence they own. */
function ownedSequenceColumns(snapshot: NextlySchemaSnapshot): Set<string> {
  return new Set(
    snapshot.tables.flatMap(table =>
      table.columns
        .filter(column => column.ownedSequenceDefault === true)
        .map(column => keyOf(table.name, column.name))
    )
  );
}

/**
 * Reads the facts for every column of `tableNames` (their live spellings). `snapshot` is the
 * introspection of the same tables: PostgreSQL's owned-sequence default is the one it already
 * records (`ColumnSpec.ownedSequenceDefault`), so it is taken from there and not read twice.
 */
export async function readLiveColumnFacts(
  db: unknown,
  dialect: SupportedDialect,
  tableNames: readonly string[],
  snapshot: NextlySchemaSnapshot
): Promise<LiveColumnFacts> {
  const facts: GatheredFacts = {
    settings: new Map(),
    generated: ownedSequenceColumns(snapshot),
    identities: new Map(),
    unreadable: new Set(),
    enforcement: new Map(),
    deferrability: new Map(),
    indexShapes: new Map(),
    counters: new Map(),
  };
  const read = new Set(tableNames.map(name => name.toLowerCase()));
  if (dialect === "sqlite") {
    await gatherSqlite(db as SqliteReader, tableNames, facts);
  } else if (tableNames.length > 0) {
    const namesIn = sql.join(
      tableNames.map(name => sql`${name}`),
      sql`, `
    );
    for (const gather of GATHERERS[dialect]) {
      await gather(db as QueryRunner, namesIn, facts);
    }
  }
  return {
    untrackedSettings: (table, column) =>
      facts.settings.get(keyOf(table, column)) ?? [],
    generatesKey: (table, column) => facts.generated.has(keyOf(table, column)),
    identityMode: (table, column) => facts.identities.get(keyOf(table, column)),
    // On MySQL only a table that was read, and read whole, has settings to answer with: a table
    // the read never reached holds whatever it holds.
    checkEnforced: (table, name) => facts.enforcement.get(keyOf(table, name)),
    keyDeferrability: (table, name) =>
      facts.deferrability.get(keyOf(table, name)),
    indexShape: (name, table) => facts.indexShapes.get(keyOf(table, name)),
    counterCovers: table => facts.counters.get(table.toLowerCase()) === true,
    settingsReadable: table =>
      dialect !== "mysql" ||
      (read.has(table.toLowerCase()) &&
        !facts.unreadable.has(table.toLowerCase())),
  };
}
