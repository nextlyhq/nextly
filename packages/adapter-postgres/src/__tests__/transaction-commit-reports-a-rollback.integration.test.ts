// A transaction PostgreSQL ends with a rollback when it was asked to commit
// is reported as failed, never as committed.
//
// After a statement fails inside a transaction, PostgreSQL aborts the
// transaction and refuses every later statement in it. A COMMIT sent then is
// not refused: the server rolls back and answers with the ROLLBACK command
// tag, raising no error. A callback that catches its failed statement and
// returns normally would therefore see `transaction()` resolve while none of
// its writes were kept.
//
// Self-skips when TEST_POSTGRES_URL is unset.

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresAdapter, type PostgresAdapter } from "../index";

const TABLE = "int_txpg_commit_rollback";
const TEST_DB_URL = process.env.TEST_POSTGRES_URL;

const canConnect = async (url: string): Promise<boolean> => {
  // Bounded connect so an unreachable TEST_POSTGRES_URL cannot hang the suite.
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
};

describe("PostgreSQL transaction whose commit the server rolls back", async () => {
  const available = TEST_DB_URL ? await canConnect(TEST_DB_URL) : false;

  if (!available) {
    it.skip("Skipping: TEST_POSTGRES_URL not set or unreachable", () => {});
    return;
  }

  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = createPostgresAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.executeQuery(`CREATE TABLE ${TABLE} (id text PRIMARY KEY)`);
  });

  afterAll(async () => {
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.disconnect();
  });

  const kept = async (id: string): Promise<number> =>
    (
      await adapter.executeQuery<{ id: string }>(
        `SELECT id FROM ${TABLE} WHERE id = $1`,
        [id]
      )
    ).length;

  it("rejects when a statement the callback caught aborted the transaction", async () => {
    const attempt = adapter.transaction(async ctx => {
      await ctx.execute(`INSERT INTO ${TABLE} (id) VALUES ($1)`, ["kept"]);
      // The duplicate key fails, and PostgreSQL aborts the transaction.
      await ctx
        .execute(`INSERT INTO ${TABLE} (id) VALUES ($1)`, ["kept"])
        .catch(() => undefined);
      return "done";
    });

    await expect(attempt).rejects.toMatchObject({ name: "DatabaseError" });
    // The control: the first insert, which succeeded, is gone with the rest.
    expect(await kept("kept")).toBe(0);
  });

  it("still commits a transaction whose statements all succeeded", async () => {
    // The control for the one above: a commit the server answers with COMMIT
    // is reported as committed, and its write is kept.
    await expect(
      adapter.transaction(async ctx => {
        await ctx.execute(`INSERT INTO ${TABLE} (id) VALUES ($1)`, ["ok"]);
        return "done";
      })
    ).resolves.toBe("done");
    expect(await kept("ok")).toBe(1);
  });
});
