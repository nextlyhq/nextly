/**
 * A generated `CREATE TABLE` declares its primary key, and the database agrees.
 *
 * Every table a migration created was key-less: the desired snapshot has
 * carried `primaryKey` since the diff needed it for the nullability exemption,
 * and the SQL renderer dropped it. Nothing caught it because no test executed a
 * generated `CREATE TABLE` and then asked the database what it had built.
 *
 * So that is what this does, per dialect, through the same `generateSQL` the
 * CLI calls: run the statement, then introspect the result and require the key
 * back. Asserting on the SQL text alone would pin the spelling without
 * establishing that any dialect accepts it — and the three disagree about
 * where `PRIMARY KEY` may sit relative to `NOT NULL`.
 */
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import mysql from "mysql2/promise";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { introspectLiveSnapshot } from "../../diff/introspect-live";
import type { AddTableOp, TableSpec } from "../../diff/types";
import { generateSQL } from "../index";

const PG_URL = process.env.TEST_POSTGRES_URL ?? "";
const MYSQL_URL = process.env.TEST_MYSQL_URL ?? "";

/** A collection table as `build-from-fields` describes one, per dialect. */
function table(name: string, idType: string): TableSpec {
  return {
    name,
    columns: [
      { name: "id", type: idType, nullable: false, primaryKey: true },
      { name: "title", type: idType, nullable: false },
    ],
    indexes: [],
  };
}

function statements(
  spec: TableSpec,
  dialect: "postgresql" | "mysql" | "sqlite"
) {
  const op: AddTableOp = { type: "add_table", table: spec };
  return generateSQL(op, dialect)
    .split(";\n")
    .map(s => s.trim())
    .filter(Boolean);
}

const pools: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const close of pools) await close();
});

describe("generated CREATE TABLE declares its primary key", () => {
  it("sqlite builds a table the database reports as keyed", async () => {
    const sqlite = new Database(":memory:");
    const db = drizzleSqlite({ client: sqlite });
    const name = "dc_pk_sqlite";

    for (const stmt of statements(table(name, "text"), "sqlite")) {
      sqlite.exec(stmt);
    }

    const live = await introspectLiveSnapshot(db, "sqlite", [name]);
    const id = live.tables[0]?.columns.find(c => c.name === "id");
    expect(id?.primaryKey).toBe(true);
    // And the column that is not the key does not claim to be one, so the
    // assertion above cannot pass by marking everything.
    expect(
      live.tables[0]?.columns.find(c => c.name === "title")?.primaryKey
    ).toBeUndefined();
    sqlite.close();
  });

  it.skipIf(!PG_URL)(
    "postgres builds a table the database reports as keyed",
    async () => {
      const pool = new Pool({ connectionString: PG_URL });
      pools.push(() => pool.end());
      const db = drizzlePg({ client: pool });
      const name = "dc_pk_postgres";

      await pool.query(`DROP TABLE IF EXISTS "${name}"`);
      for (const stmt of statements(table(name, "text"), "postgresql")) {
        await pool.query(stmt);
      }

      const live = await introspectLiveSnapshot(db, "postgresql", [name]);
      const id = live.tables[0]?.columns.find(c => c.name === "id");
      expect(id?.primaryKey).toBe(true);
      expect(
        live.tables[0]?.columns.find(c => c.name === "title")?.primaryKey
      ).toBeUndefined();
      await pool.query(`DROP TABLE IF EXISTS "${name}"`);
    }
  );

  it.skipIf(!MYSQL_URL)(
    "mysql builds a table the database reports as keyed",
    async () => {
      const conn = await mysql.createConnection(MYSQL_URL);
      pools.push(() => conn.end());
      const db = drizzleMysql({ client: conn });
      const name = "dc_pk_mysql";

      await conn.query(`DROP TABLE IF EXISTS \`${name}\``);
      for (const stmt of statements(table(name, "varchar(36)"), "mysql")) {
        await conn.query(stmt);
      }

      const live = await introspectLiveSnapshot(db, "mysql", [name]);
      const id = live.tables[0]?.columns.find(c => c.name === "id");
      expect(id?.primaryKey).toBe(true);
      expect(
        live.tables[0]?.columns.find(c => c.name === "title")?.primaryKey
      ).toBeUndefined();
      await conn.query(`DROP TABLE IF EXISTS \`${name}\``);
    }
  );

  it("a composite key becomes a table constraint the database accepts", async () => {
    // No table Nextly generates has one today. It is covered because the
    // inline spelling is a syntax error for two columns rather than a
    // composite key, so the branch has to exist and has to be right before
    // anything relies on it.
    const sqlite = new Database(":memory:");
    const name = "dc_pk_composite";
    const spec: TableSpec = {
      name,
      columns: [
        { name: "left_id", type: "text", nullable: false, primaryKey: true },
        { name: "right_id", type: "text", nullable: false, primaryKey: true },
      ],
      indexes: [],
    };

    const sql = statements(spec, "sqlite")[0];
    expect(sql).toContain('PRIMARY KEY ("left_id", "right_id")');
    // One key for the table, not one per column.
    expect(sql.match(/PRIMARY KEY/g)).toHaveLength(1);
    sqlite.exec(sql);

    const db = drizzleSqlite({ client: sqlite });
    const live = await introspectLiveSnapshot(db, "sqlite", [name]);
    expect(
      live.tables[0]?.columns
        .filter(c => c.primaryKey === true)
        .map(c => c.name)
    ).toEqual(["left_id", "right_id"]);
    sqlite.close();
  });

  it("does not declare a key on ADD COLUMN", async () => {
    // The renderer is shared with the altering paths, and no dialect accepts
    // an inline key on a column added to a table that already exists.
    const sql = generateSQL(
      {
        type: "add_column",
        tableName: "dc_pk_sqlite",
        column: {
          name: "late",
          type: "text",
          nullable: false,
          primaryKey: true,
        },
      },
      "sqlite"
    );
    expect(sql).not.toContain("PRIMARY KEY");
  });
});
