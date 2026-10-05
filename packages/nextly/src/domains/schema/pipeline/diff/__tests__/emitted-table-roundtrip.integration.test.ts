/**
 * A table the dev-push emitter creates, read back from the real database and
 * compared with the spec it was created from.
 *
 * Three properties, each only observable on a real server:
 *
 * - The emitted DDL is what was declared: a database-assigned key named
 *   something other than `id` is the primary key and assigns its own values,
 *   a partial unique index still admits the rows its predicate leaves out, and
 *   an expression index is created at all.
 * - Introspection sees the predicate and the expression. The servers print
 *   both in their own spelling (`(deleted_at IS NULL)`, `lower((email)::text)`,
 *   ``lower(`email`)``), so the snapshot records what they print.
 * - The diff reads the two spellings as the same index and the serial key's
 *   sequence default as no change, so a second push plans nothing. Before
 *   that held, the index was re-planned — and on SQLite dropped and recreated —
 *   on every push.
 *
 * Gated on TEST_POSTGRES_URL / TEST_MYSQL_URL like the other integration
 * tests; SQLite runs in memory.
 *
 * @module domains/schema/pipeline/diff/__tests__/emitted-table-roundtrip.integration
 */
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool, type Pool } from "mysql2";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { emitDdl } from "../../ddl-emitter";
import { diffSnapshots } from "../diff";
import { introspectLiveSnapshot } from "../introspect-live";
import type { TableSpec } from "../types";

const PG_URL = process.env.TEST_POSTGRES_URL ?? "";
const MYSQL_URL = process.env.TEST_MYSQL_URL ?? "";

const TABLE = "nx_emit_rt_accounts";

/** The spec under test, per dialect: the types each one introspects back. */
function spec(dialect: "postgresql" | "mysql" | "sqlite"): TableSpec {
  const keyType = { postgresql: "int4", mysql: "int", sqlite: "integer" }[
    dialect
  ];
  // MySQL cannot index a TEXT expression, so its strings are sized there.
  const text = dialect === "mysql" ? "varchar(100)" : "text";
  return {
    name: TABLE,
    columns: [
      {
        name: "seq",
        type: keyType,
        nullable: false,
        primaryKey: true,
        autoIncrement: true,
      },
      { name: "email", type: text, nullable: true },
      { name: "deleted_at", type: text, nullable: true },
    ],
    indexes: [
      {
        name: `idx_${TABLE}_email_lower`,
        columns: [],
        unique: false,
        expression: "lower(email)",
      },
      // Two keys, one an expression and one a plain column: rendered as two
      // keys, and read back one key at a time.
      {
        name: `idx_${TABLE}_email_deleted`,
        columns: [],
        unique: false,
        expression: "lower(email), deleted_at",
      },
      // MySQL has no partial indexes; the other two carry one.
      ...(dialect === "mysql"
        ? []
        : [
            {
              name: `idx_${TABLE}_email_live`,
              columns: ["email"],
              unique: true,
              where: "deleted_at IS NULL",
            },
          ]),
    ],
  };
}

/** Everything the three dialect blocks below assert, given a way to run SQL. */
function roundTrip(
  dialect: "postgresql" | "mysql" | "sqlite",
  run: (statement: string) => Promise<void>,
  db: () => unknown
): void {
  it("assigns the key itself and creates it as the primary key", async () => {
    await run(`INSERT INTO ${TABLE} (email) VALUES ('a@x')`);
    await run(
      `INSERT INTO ${TABLE} (email, deleted_at) VALUES ('a@x', 'gone')`
    );
    const live = await introspectLiveSnapshot(db(), dialect, [TABLE]);
    const seq = live.tables[0]?.columns.find(c => c.name === "seq");
    expect(seq?.primaryKey).toBe(true);
  });

  if (dialect !== "mysql") {
    it("keeps the partial unique index partial", async () => {
      // Two live rows with one email are refused; the deleted row above was
      // admitted, which a full unique index would have refused.
      await expect(
        run(`INSERT INTO ${TABLE} (email) VALUES ('a@x')`)
      ).rejects.toThrow();
    });
  }

  it("reads the predicate and the expression back", async () => {
    const live = await introspectLiveSnapshot(db(), dialect, [TABLE]);
    const indexes = live.tables[0]?.indexes ?? [];
    const lower = indexes.find(i => i.name === `idx_${TABLE}_email_lower`);
    expect(lower?.columns).toEqual([]);
    expect(lower?.expression).toMatch(/lower/i);
    const pair = indexes.find(i => i.name === `idx_${TABLE}_email_deleted`);
    expect(pair?.columns).toEqual([]);
    expect(pair?.expression).toMatch(/lower.*,\s*`?deleted_at`?$/i);
    if (dialect !== "mysql") {
      const liveOnly = indexes.find(i => i.name === `idx_${TABLE}_email_live`);
      expect(liveOnly?.columns).toEqual(["email"]);
      expect(liveOnly?.where).toMatch(/deleted_at/i);
    }
  });

  it("plans nothing when the same spec is pushed again", async () => {
    const live = await introspectLiveSnapshot(db(), dialect, [TABLE]);
    expect(
      diffSnapshots({ tables: live.tables }, { tables: [spec(dialect)] })
    ).toEqual([]);
  });
}

describe.skipIf(!PG_URL)("emitted table round trip — postgresql", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: PG_URL });
    await client.connect();
    await client.query(`DROP TABLE IF EXISTS ${TABLE}`);
    for (const statement of emitDdl(
      [{ type: "add_table", table: spec("postgresql") }],
      "postgresql"
    )) {
      await client.query(statement);
    }
  });
  afterAll(async () => {
    await client.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await client.end();
  });
  roundTrip(
    "postgresql",
    async statement => {
      await client.query(statement);
    },
    () => drizzlePg({ client })
  );
});

describe.skipIf(!MYSQL_URL)("emitted table round trip — mysql", () => {
  let pool: Pool;
  const query = (text: string) => pool.promise().query(text);
  beforeAll(async () => {
    // A callback pool: drizzle's mysql2 driver reads `client.config`, which a
    // promise pool does not have.
    pool = createPool({ uri: MYSQL_URL });
    await query(`DROP TABLE IF EXISTS ${TABLE}`);
    for (const statement of emitDdl(
      [{ type: "add_table", table: spec("mysql") }],
      "mysql"
    )) {
      await query(statement);
    }
  });
  afterAll(async () => {
    await query(`DROP TABLE IF EXISTS ${TABLE}`);
    await pool.promise().end();
  });
  roundTrip(
    "mysql",
    async statement => {
      await query(statement);
    },
    () => drizzleMysql({ client: pool })
  );
});

describe("emitted table round trip — sqlite", () => {
  const sqlite = new Database(":memory:");
  beforeAll(() => {
    for (const statement of emitDdl(
      [{ type: "add_table", table: spec("sqlite") }],
      "sqlite"
    )) {
      sqlite.exec(statement);
    }
  });
  afterAll(() => sqlite.close());
  roundTrip(
    "sqlite",
    // Deferred into a promise so a refused statement rejects rather than
    // throwing while the assertion's argument is still being evaluated.
    statement =>
      Promise.resolve().then(() => {
        sqlite.exec(statement);
      }),
    () => drizzleSqlite({ client: sqlite })
  );
});
