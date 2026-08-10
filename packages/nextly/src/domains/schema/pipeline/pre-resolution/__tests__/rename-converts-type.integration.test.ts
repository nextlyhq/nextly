// Recovering a column that carries BOTH a legacy name and a legacy type, with its contents.
//
// A table created before the column-name fix can hold `_items` where everything else addresses
// `items`, and for a repeater or a group it also holds `text` where the descriptor asks for JSON.
// The recovery on offer is a rename, and a rename moves the column without changing what it is: run
// alone it leaves a text column under the new name, which the runtime then reads through a schema
// that says JSON.
//
// Only a live server can show the pair is accepted. PostgreSQL rejects `ALTER COLUMN ... TYPE jsonb`
// outright without a USING clause, so a template that looks right can still fail at apply time, and
// that is precisely the failure this suite exists to catch. The contents are written BEFORE the
// repair and read back after, because a conversion that succeeds and empties the column would pass
// every assertion about the column's type.

import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../../database/__tests__/integration/helpers/test-db";
import type { Operation } from "../../diff/types";
import { executePreResolutionOps } from "../executor";

const ctx = makeTestContext("postgresql");

describe("a rename that also changes the column's type — PostgreSQL", () => {
  if (!ctx.available || !ctx.url) {
    it.skip("Skipping: TEST_POSTGRES_URL not set", () => {});
    return;
  }

  const table = `${ctx.prefix}_legacy_repair`;
  let pool: Pool;
  let db: ReturnType<typeof drizzlePg>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: ctx.url ?? undefined });
    db = drizzlePg({ client: pool });
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    await pool.end();
  });

  it("moves the column, converts it, and keeps what was in it", async () => {
    await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    // The shape an affected table is actually in: the legacy NAME and the legacy TYPE together.
    await pool.query(
      `CREATE TABLE "${table}" ("id" text PRIMARY KEY, "_items" text)`
    );
    const stored = JSON.stringify([{ label: "one" }, { label: "two" }]);
    await pool.query(`INSERT INTO "${table}" VALUES ('r1', $1)`, [stored]);

    const ops: Operation[] = [
      {
        type: "rename_column",
        tableName: table,
        fromColumn: "_items",
        toColumn: "items",
        fromType: "text",
        toType: "jsonb",
      },
    ];

    await expect(executePreResolutionOps(db, ops, "postgresql")).resolves.toBe(
      1
    );

    const shape = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`,
      [table]
    );
    const items = shape.rows.find(r => r.column_name === "items");
    expect(items, "the column reached its canonical name").toBeDefined();
    expect(items?.data_type, "and its declared type").toBe("jsonb");
    expect(
      shape.rows.map(r => r.column_name),
      "the legacy name is gone"
    ).not.toContain("_items");

    // The whole point. A conversion that dropped the contents would satisfy everything above.
    const read = await pool.query<{ items: unknown }>(
      `SELECT "items" FROM "${table}" WHERE "id" = 'r1'`
    );
    expect(read.rows[0]?.items, "the values survived the repair").toEqual([
      { label: "one" },
      { label: "two" },
    ]);
  });

  // Same name, same type: the conversion must not fire, because emitting an ALTER TYPE for a column
  // that already has that type is a rewrite of the whole table for nothing.
  it("issues no conversion when only the name changes", async () => {
    await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    await pool.query(
      `CREATE TABLE "${table}" ("id" text PRIMARY KEY, "_title" text)`
    );
    await pool.query(`INSERT INTO "${table}" VALUES ('r1', 'kept')`);

    await expect(
      executePreResolutionOps(
        db,
        [
          {
            type: "rename_column",
            tableName: table,
            fromColumn: "_title",
            toColumn: "title",
            fromType: "text",
            toType: "text",
          },
        ] as Operation[],
        "postgresql"
      )
    ).resolves.toBe(1);

    const read = await pool.query<{ title: string }>(
      `SELECT "title" FROM "${table}" WHERE "id" = 'r1'`
    );
    expect(read.rows[0]?.title).toBe("kept");
  });
});

const mysqlCtx = makeTestContext("mysql");

describe("a rename that also changes the column's type — MySQL", () => {
  if (!mysqlCtx.available || !mysqlCtx.url) {
    it.skip("Skipping: TEST_MYSQL_URL not set", () => {});
    return;
  }

  const table = `${mysqlCtx.prefix}_legacy_repair`;
  let pool: MysqlPool;
  // Held as the executor's own parameter type. Naming drizzle's generic here instead makes two
  // structurally identical instantiations of it collide under `check-types`, and the executor never
  // looks at more than the call pattern anyway.
  let db: unknown;

  beforeAll(() => {
    pool = createPool({ uri: mysqlCtx.url as string });
    db = drizzleMysql({ client: pool });
  });

  afterAll(async () => {
    await pool.promise().query(`DROP TABLE IF EXISTS \`${table}\``);
    await new Promise<void>(res => pool.end(() => res()));
  });

  it("moves the column, converts it, and keeps what was in it", async () => {
    const q = pool.promise();
    await q.query(`DROP TABLE IF EXISTS \`${table}\``);
    await q.query(
      `CREATE TABLE \`${table}\` (\`id\` varchar(36) PRIMARY KEY, \`_items\` text)`
    );
    await q.query(`INSERT INTO \`${table}\` VALUES ('r1', ?)`, [
      JSON.stringify([{ label: "one" }]),
    ]);

    await expect(
      executePreResolutionOps(
        db,
        [
          {
            type: "rename_column",
            tableName: table,
            fromColumn: "_items",
            toColumn: "items",
            fromType: "text",
            toType: "json",
          },
        ] as Operation[],
        "mysql"
      )
    ).resolves.toBe(1);

    const [cols] = await q.query(
      `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [table]
    );
    const columns = cols as Array<{ COLUMN_NAME: string; DATA_TYPE: string }>;
    expect(columns.map(c => c.COLUMN_NAME)).toContain("items");
    expect(columns.map(c => c.COLUMN_NAME)).not.toContain("_items");
    expect(columns.find(c => c.COLUMN_NAME === "items")?.DATA_TYPE).toBe(
      "json"
    );

    // The whole point: a conversion that emptied the column would satisfy everything above.
    const [rows] = await q.query(
      `SELECT \`items\` FROM \`${table}\` WHERE \`id\` = 'r1'`
    );
    const value = (rows as Array<{ items: unknown }>)[0]?.items;
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    expect(parsed, "the values survived the repair").toEqual([
      { label: "one" },
    ]);
  });
});
