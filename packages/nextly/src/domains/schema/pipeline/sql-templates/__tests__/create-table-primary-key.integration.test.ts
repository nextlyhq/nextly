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

  it.skipIf(!MYSQL_URL)(
    "mysql round-trips a live snapshot back into DDL the server accepts",
    async () => {
      // MySQL reports a string default WITHOUT quotes, unlike PostgreSQL and
      // SQLite. Recorded verbatim it renders `DEFAULT draft`, which the server
      // reads as an identifier — so the schema a live snapshot describes could
      // not be rebuilt anywhere.
      //
      // The source table is built by the generator rather than by hand, which
      // makes this a closed loop: spec -> DDL -> live -> spec. A hand-written
      // fixture could drift from the generator this is meant to protect, and
      // would also let the assertion agree with a shape nothing produces.
      const conn = await mysql.createConnection(MYSQL_URL);
      pools.push(() => conn.end());
      const db = drizzleMysql({ client: conn });
      const source = "dc_mysql_defaults";
      const rebuilt = "dc_mysql_defaults_rebuilt";

      const spec: TableSpec = {
        name: source,
        columns: [
          {
            name: "id",
            type: "varchar(36)",
            nullable: false,
            primaryKey: true,
          },
          {
            name: "status",
            type: "varchar(20)",
            nullable: false,
            default: "'draft'",
          },
          { name: "quantity", type: "int", nullable: true, default: "5" },
          // An embedded quote and a backslash: MySQL treats the backslash as
          // an escape introducer, so a default re-emitted with only the quote
          // handled would come back as a different string.
          {
            name: "note",
            type: "varchar(40)",
            nullable: true,
            default: "'it''s a\\\\nb'",
          },
          {
            name: "made_at",
            type: "datetime",
            nullable: true,
            default: "CURRENT_TIMESTAMP",
          },
        ],
        indexes: [],
      };

      await conn.query(`DROP TABLE IF EXISTS \`${source}\``);
      await conn.query(`DROP TABLE IF EXISTS \`${rebuilt}\``);
      for (const stmt of statements(spec, "mysql")) await conn.query(stmt);

      const live = await introspectLiveSnapshot(db, "mysql", [source]);
      const observed = live.tables[0];
      expect(observed).toBeDefined();
      // What the generator was given comes back unchanged, which is the
      // property a snapshot needs to be rebuildable at all.
      expect(observed!.columns.map(c => [c.name, c.default])).toEqual(
        spec.columns.map(c => [c.name, c.default])
      );
      expect(observed!.columns.find(c => c.name === "id")?.primaryKey).toBe(
        true
      );

      // And it rebuilds from its own live snapshot.
      for (const stmt of statements({ ...observed!, name: rebuilt }, "mysql")) {
        await conn.query(stmt);
      }
      const after = await introspectLiveSnapshot(db, "mysql", [rebuilt]);
      expect(after.tables[0]?.columns.map(c => c.default)).toEqual(
        observed!.columns.map(c => c.default)
      );

      await conn.query(`DROP TABLE IF EXISTS \`${source}\``);
      await conn.query(`DROP TABLE IF EXISTS \`${rebuilt}\``);
    }
  );

  it.skipIf(!MYSQL_URL)(
    "mysql does not call a unique index the primary key",
    async () => {
      // `COLUMN_KEY` does not mean what its name suggests. A table with no
      // primary key but a NOT NULL UNIQUE index reports `PRI` for that column,
      // because InnoDB promotes such an index to the clustered key. Reading it
      // would mark `slug` as the primary key, hiding a table that has none and
      // rebuilding it elsewhere with the wrong one.
      const conn = await mysql.createConnection(MYSQL_URL);
      pools.push(() => conn.end());
      const db = drizzleMysql({ client: conn });
      const name = "dc_mysql_promoted";

      await conn.query(`DROP TABLE IF EXISTS \`${name}\``);
      await conn.query(
        `CREATE TABLE \`${name}\` (slug varchar(40) NOT NULL UNIQUE, other varchar(10)) ENGINE=InnoDB`
      );

      const live = await introspectLiveSnapshot(db, "mysql", [name]);
      expect(
        live.tables[0]?.columns.filter(c => c.primaryKey === true)
      ).toEqual([]);

      await conn.query(`DROP TABLE IF EXISTS \`${name}\``);
    }
  );

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
