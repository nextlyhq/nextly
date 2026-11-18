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
 * Read-only: one query on PostgreSQL, two on MySQL (the first asks whether the catalog has the
 * spatial-reference column), none on SQLite.
 *
 * @module domains/schema/migrate/live-column-facts
 */
import { sql } from "drizzle-orm";

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
   * back. False for a MySQL table whose engine keeps column attributes the catalog read here does
   * not report (NDB's `COLUMN_FORMAT` and `STORAGE`): nothing then shows what a column holds.
   */
  settingsReadable(table: string): boolean;
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
export function mysqlUntrackedSettings(row: MysqlColumnRow): string[] {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const extra = text(row.extra).toLowerCase();
  const collation = text(row.collation);
  return [
    ...(collation !== "" && collation !== text(row.table_collation)
      ? [`COLLATE ${collation}`]
      : []),
    ...(text(row.generated) !== "" ? ["GENERATED"] : []),
    ...(extra.includes("auto_increment") ? ["AUTO_INCREMENT"] : []),
    ...(extra.includes("on update") ? ["ON UPDATE"] : []),
    ...(extra.includes("invisible") ? ["INVISIBLE"] : []),
    ...(row.srid !== null && row.srid !== undefined ? ["SRID"] : []),
    ...(text(row.comment) !== "" ? ["COMMENT"] : []),
  ];
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
  const settings = new Map<string, readonly string[]>();
  const generated = new Set<string>();
  const identities = new Map<string, "always" | "by-default">();
  const unreadable = new Set<string>();
  for (const table of snapshot.tables) {
    for (const column of table.columns) {
      if (column.ownedSequenceDefault === true) {
        generated.add(keyOf(table.name, column.name));
      }
    }
  }
  if (tableNames.length > 0 && dialect !== "sqlite") {
    const namesIn = sql.join(
      tableNames.map(name => sql`${name}`),
      sql`, `
    );
    const runner = db as QueryRunner;
    if (dialect === "postgresql") {
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
        if (typeof table === "string" && typeof column === "string") {
          generated.add(keyOf(table, column));
          // `a` is GENERATED ALWAYS, `d` GENERATED BY DEFAULT.
          identities.set(
            keyOf(table, column),
            identity === "a" ? "always" : "by-default"
          );
        }
      }
    } else {
      // `SRS_ID` is MySQL's column: a server of the same dialect without it (MariaDB) refuses a
      // query naming it, so it is read only where the catalog has it.
      const srid = (await mysqlCatalogHasSrid(runner))
        ? sql`c.SRS_ID`
        : sql`NULL`;
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
          unreadable.add(table.toLowerCase());
        }
        const kept = mysqlUntrackedSettings(row as unknown as MysqlColumnRow);
        if (kept.length > 0) settings.set(keyOf(table, column), kept);
        if (kept.includes("AUTO_INCREMENT")) {
          generated.add(keyOf(table, column));
        }
      }
    }
  }
  return {
    untrackedSettings: (table, column) =>
      settings.get(keyOf(table, column)) ?? [],
    generatesKey: (table, column) => generated.has(keyOf(table, column)),
    identityMode: (table, column) => identities.get(keyOf(table, column)),
    settingsReadable: table => !unreadable.has(table.toLowerCase()),
  };
}
