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

/**
 * The same shape, holding prose instead of JSON — and the repair must refuse it.
 *
 * A leading underscore proves the old builder wrote the column. It does not prove what the column
 * contains: the underscore affected every field type, so a field once declared as ordinary text
 * carries `_body` too. Change that field to a repeater and the pair is indistinguishable from a
 * genuine legacy repeater by name, by SQL type, and by anything else the schema records.
 *
 * On MySQL the refusal has to come BEFORE the rename. DDL commits implicitly there, so a conversion
 * refused one statement later leaves the column renamed and unconverted with nothing able to take it
 * back — which is why these assert the OLD name still resolves afterwards, not merely that the call
 * rejected.
 */
describe("a legacy column holding prose is not converted — PostgreSQL", () => {
  const proseCtx = makeTestContext("postgresql");
  if (!proseCtx.available || !proseCtx.url) {
    it.skip("Skipping: TEST_POSTGRES_URL not set", () => {});
    return;
  }

  const table = `${proseCtx.prefix}_prose`;
  let pool: Pool;
  let db: ReturnType<typeof drizzlePg>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: proseCtx.url ?? undefined });
    db = drizzlePg({ client: pool });
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    await pool.end();
  });

  it("refuses, and leaves the column exactly as it was", async () => {
    await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    await pool.query(
      `CREATE TABLE "${table}" ("id" text PRIMARY KEY, "_body" text)`
    );
    // Prose, which is what a text field held before someone changed it to a repeater.
    await pool.query(`INSERT INTO "${table}" VALUES ('r1', $1)`, [
      "the quick brown fox",
    ]);

    const ops: Operation[] = [
      {
        type: "rename_column",
        tableName: table,
        fromColumn: "_body",
        toColumn: "body",
        fromType: "text",
        toType: "jsonb",
      },
    ];

    // Asserted on the typed payload rather than the message: `NextlyError.validation` sets a generic
    // public message and carries the detail in `publicData`, so matching on text would pass for any
    // validation failure at all.
    await expect(
      executePreResolutionOps(db, ops, "postgresql")
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [expect.objectContaining({ code: "COLUMN_NOT_CONVERTIBLE" })],
      },
    });

    // Nothing ran: the column still answers to its old name and still holds what it held.
    const after = await pool.query<{ _body: string }>(
      `SELECT "_body" FROM "${table}" WHERE id = 'r1'`
    );
    expect(after.rows[0]?._body).toBe("the quick brown fox");
  });

  it("refuses when only a LATER row is prose", async () => {
    // The row order is the test. A probe that stops at the first row satisfying it — anything
    // shaped `WHERE c::jsonb IS NOT NULL LIMIT 1` — reports this column convertible on the strength
    // of row one and never reads row two, and the conversion then fails on the row the probe
    // skipped. That is the mid-apply failure the guard exists to prevent, so it has to be the case
    // the guard is measured against.
    const mixed = `${proseCtx.prefix}_mixed`;
    await pool.query(`DROP TABLE IF EXISTS "${mixed}" CASCADE`);
    await pool.query(
      `CREATE TABLE "${mixed}" ("id" text PRIMARY KEY, "_body" text)`
    );
    await pool.query(`INSERT INTO "${mixed}" VALUES ('r1', $1), ('r2', $2)`, [
      JSON.stringify({ ok: 1 }),
      "the quick brown fox",
    ]);

    await expect(
      executePreResolutionOps(
        db,
        [
          {
            type: "rename_column",
            tableName: mixed,
            fromColumn: "_body",
            toColumn: "body",
            fromType: "text",
            toType: "jsonb",
          },
        ] as Operation[],
        "postgresql"
      )
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [expect.objectContaining({ code: "COLUMN_NOT_CONVERTIBLE" })],
      },
    });

    const after = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [mixed]
    );
    expect(after.rows.map(r => r.column_name)).toContain("_body");
    await pool.query(`DROP TABLE IF EXISTS "${mixed}" CASCADE`);
  });

  it("reports a probe that could not run as itself, not as bad data", async () => {
    // A guard that reads every error as "unconvertible" gives the operator a confident, specific and
    // wrong diagnosis: it names their data when the real cause is a missing table, a lock timeout or
    // a permission. They then go looking in the rows. The probe raises SQLSTATE 22P02 for malformed
    // JSON and 42P01 for a table that is not there, and only the data class may answer the question.
    const missing = `${proseCtx.prefix}_absent`;

    await expect(
      executePreResolutionOps(
        db,
        [
          {
            type: "rename_column",
            tableName: missing,
            fromColumn: "_body",
            toColumn: "body",
            fromType: "text",
            toType: "jsonb",
          },
        ] as Operation[],
        "postgresql"
      )
      // Asserted on the cause, because Drizzle wraps the driver error and the SQLSTATE stays on the
      // original underneath — which is also why the guard walks the chain rather than reading the
      // top object.
    ).rejects.toMatchObject({ cause: { code: "42P01" } });
  });

  it("still converts a column that does hold JSON", async () => {
    // The positive control. A guard that refused everything would satisfy the cases above while
    // breaking the repair this programme exists to provide.
    const jsonTable = `${proseCtx.prefix}_json_ok`;
    await pool.query(`DROP TABLE IF EXISTS "${jsonTable}" CASCADE`);
    await pool.query(
      `CREATE TABLE "${jsonTable}" ("id" text PRIMARY KEY, "_body" text)`
    );
    await pool.query(`INSERT INTO "${jsonTable}" VALUES ('r1', $1)`, [
      JSON.stringify([{ label: "one" }]),
    ]);

    await executePreResolutionOps(
      db,
      [
        {
          type: "rename_column",
          tableName: jsonTable,
          fromColumn: "_body",
          toColumn: "body",
          fromType: "text",
          toType: "jsonb",
        },
      ] as Operation[],
      "postgresql"
    );

    const shape = await pool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = 'body'`,
      [jsonTable]
    );
    expect(shape.rows[0]?.data_type).toBe("jsonb");
    await pool.query(`DROP TABLE IF EXISTS "${jsonTable}" CASCADE`);
  });
});

/**
 * The same refusal on MySQL, where getting it wrong is not recoverable.
 *
 * PostgreSQL runs the whole apply inside a transaction, so a conversion that fails mid-way rolls
 * back and the operator is merely inconvenienced. MySQL commits DDL as it makes it: a rename that
 * has already executed stays executed, and no rollback exists to undo it. That makes the ordering —
 * ask first, then execute — the entire substance of the guard here rather than a nicety, and it can
 * only be shown against a live server that really does auto-commit.
 */
describe("a legacy column holding prose is not converted — MySQL", () => {
  if (!mysqlCtx.available || !mysqlCtx.url) {
    it.skip("Skipping: TEST_MYSQL_URL not set", () => {});
    return;
  }

  const table = `${mysqlCtx.prefix}_prose`;
  let pool: MysqlPool;
  // Held as the executor's own parameter type, for the reason given on the suite above: naming
  // drizzle's generic makes two structurally identical instantiations collide under `check-types`.
  let db: unknown;

  beforeAll(() => {
    pool = createPool({ uri: mysqlCtx.url as string });
    db = drizzleMysql({ client: pool });
  });

  afterAll(async () => {
    await pool.promise().query(`DROP TABLE IF EXISTS \`${table}\``);
    await new Promise<void>(res => pool.end(() => res()));
  });

  it("refuses before renaming, so the column is left whole", async () => {
    const q = pool.promise();
    await q.query(`DROP TABLE IF EXISTS \`${table}\``);
    await q.query(
      `CREATE TABLE \`${table}\` (\`id\` varchar(36) PRIMARY KEY, \`_body\` text)`
    );
    await q.query(`INSERT INTO \`${table}\` VALUES ('r1', ?)`, [
      "the quick brown fox",
    ]);

    await expect(
      executePreResolutionOps(
        db,
        [
          {
            type: "rename_column",
            tableName: table,
            fromColumn: "_body",
            toColumn: "body",
            fromType: "text",
            toType: "json",
          },
        ] as Operation[],
        "mysql"
      )
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [expect.objectContaining({ code: "COLUMN_NOT_CONVERTIBLE" })],
      },
    });

    // The assertion the dialect exists for. A refusal raised one statement too late would still
    // reject, and `_body` would already be gone with no transaction able to bring it back.
    const [cols] = await q.query(
      `SELECT COLUMN_NAME FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [table]
    );
    const names = (cols as Array<{ COLUMN_NAME: string }>).map(
      c => c.COLUMN_NAME
    );
    expect(names, "the rename did not run").toContain("_body");
    expect(names).not.toContain("body");

    const [rows] = await q.query(
      `SELECT \`_body\` FROM \`${table}\` WHERE \`id\` = 'r1'`
    );
    expect((rows as Array<{ _body: string }>)[0]?._body).toBe(
      "the quick brown fox"
    );
  });

  it("still converts a column that does hold JSON", async () => {
    // The positive control: without it, a guard that refused every MySQL conversion would pass the
    // test above while removing the repair entirely.
    const q = pool.promise();
    const jsonTable = `${mysqlCtx.prefix}_json_ok`;
    await q.query(`DROP TABLE IF EXISTS \`${jsonTable}\``);
    await q.query(
      `CREATE TABLE \`${jsonTable}\` (\`id\` varchar(36) PRIMARY KEY, \`_body\` text)`
    );
    await q.query(`INSERT INTO \`${jsonTable}\` VALUES ('r1', ?)`, [
      JSON.stringify([{ label: "one" }]),
    ]);

    await expect(
      executePreResolutionOps(
        db,
        [
          {
            type: "rename_column",
            tableName: jsonTable,
            fromColumn: "_body",
            toColumn: "body",
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
      [jsonTable]
    );
    const columns = cols as Array<{ COLUMN_NAME: string; DATA_TYPE: string }>;
    expect(columns.find(c => c.COLUMN_NAME === "body")?.DATA_TYPE).toBe("json");
    await q.query(`DROP TABLE IF EXISTS \`${jsonTable}\``);
  });
});
