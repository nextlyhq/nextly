/**
 * The registry tells a table of one of the three dialects from everything
 * else, by the kind drizzle marks it with and not by a dialect's own class.
 *
 * A table is kept under the name it has in SQL, and anything else under the
 * key it was exported by, so which it was taken for is read from the key it is
 * found under.
 *
 * What would separate a correct answer from a broken one:
 * - a table of any of the three missed, an aliased one or one in a schema of
 *   its own among them;
 * - one made by another copy of drizzle missed, as an app that holds two has;
 * - a view, a column or a plain object taken for a table;
 * - a table of a database Nextly does not run on taken for one of the three,
 *   as drizzle's own common class would.
 */
import { createRequire } from "node:module";

import { is, sql, Table } from "drizzle-orm";
import * as mysql from "drizzle-orm/mysql-core";
import * as pg from "drizzle-orm/pg-core";
import * as singlestore from "drizzle-orm/singlestore-core";
import * as sqlite from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { SchemaRegistry } from "../schema-registry";

const pgTable = pg.pgTable("in_sql", { id: pg.text("id") });
const mysqlTable = mysql.mysqlTable("in_sql", {
  id: mysql.varchar("id", { length: 3 }),
});
const sqliteTable = sqlite.sqliteTable("in_sql", { id: sqlite.text("id") });

/** Another copy of drizzle in the same process: the one `require` is given. */
const other = createRequire(import.meta.url);
const otherPg = other("drizzle-orm/pg-core") as typeof pg;
const otherMysql = other("drizzle-orm/mysql-core") as typeof mysql;
const otherSqlite = other("drizzle-orm/sqlite-core") as typeof sqlite;

const TABLES: Record<string, unknown> = {
  "a PostgreSQL table": pgTable,
  "a MySQL table": mysqlTable,
  "a SQLite table": sqliteTable,
  "a PostgreSQL table in a schema": pg
    .pgSchema("own")
    .table("in_sql", { id: pg.text("id") }),
  "a PostgreSQL table with row-level security": pg.pgTable.withRLS("in_sql", {
    id: pg.text("id"),
  }),
  "an aliased PostgreSQL table": pg.alias(pgTable, "in_sql"),
  "an aliased MySQL table": mysql.alias(mysqlTable, "in_sql"),
  "an aliased SQLite table": sqlite.alias(sqliteTable, "in_sql"),
  "another copy's PostgreSQL table": otherPg.pgTable("in_sql", {
    id: otherPg.text("id"),
  }),
  "another copy's MySQL table": otherMysql.mysqlTable("in_sql", {
    id: otherMysql.varchar("id", { length: 3 }),
  }),
  "another copy's SQLite table": otherSqlite.sqliteTable("in_sql", {
    id: otherSqlite.text("id"),
  }),
};

const OTHERS: Record<string, unknown> = {
  "a PostgreSQL view": pg
    .pgView("in_sql", { id: pg.text("id") })
    .as(sql`select 1`),
  "a PostgreSQL materialised view": pg
    .pgMaterializedView("in_sql", { id: pg.text("id") })
    .as(sql`select 1`),
  "a MySQL view": mysql
    .mysqlView("in_sql", { id: mysql.varchar("id", { length: 3 }) })
    .as(sql`select 1`),
  "a SQLite view": sqlite
    .sqliteView("in_sql", { id: sqlite.text("id") })
    .as(sql`select 1`),
  "a column": pgTable.id,
  "an enum": pg.pgEnum("in_sql", ["a"]),
  "a piece of SQL": sql`1`,
  "an object named as a table is": { _: { name: "in_sql" } },
  "an object without a prototype": Object.create(null),
  "a list holding a table": [pgTable],
  "no object": "in_sql",
  nothing: undefined,
  "a SingleStore table": singlestore.singlestoreTable("in_sql", {
    id: singlestore.text("id"),
  }),
};

/** The key the registry keeps `value` under, having been given it as `exported`. */
function keptUnder(value: unknown): string {
  const registry = new SchemaRegistry("sqlite");
  registry.registerStaticSchemas({ exported: value });
  return registry.hasTable("exported") ? "exported" : "in_sql";
}

describe("what the registry takes for a table", () => {
  it.each(Object.entries(TABLES))("is %s", (_name, value) => {
    expect(keptUnder(value)).toBe("in_sql");
  });

  it.each(Object.entries(OTHERS))("is not %s", (_name, value) => {
    expect(keptUnder(value)).toBe("exported");
  });

  it("is what each dialect's own class says it is", () => {
    const byClass = (value: unknown) =>
      is(value, pg.PgTable) ||
      is(value, mysql.MySqlTable) ||
      is(value, sqlite.SQLiteTable);
    for (const [name, value] of Object.entries({ ...TABLES, ...OTHERS })) {
      expect(keptUnder(value) === "in_sql", name).toBe(byClass(value));
    }
  });

  it("is told apart by these cases: another copy's is another class, and a SingleStore table is a table", () => {
    expect(TABLES["another copy's PostgreSQL table"]).not.toBeInstanceOf(
      pg.PgTable
    );
    expect(is(OTHERS["a SingleStore table"], Table)).toBe(true);
  });
});
