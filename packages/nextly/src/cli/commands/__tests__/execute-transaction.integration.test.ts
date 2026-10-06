/**
 * `executeTransaction` must keep BEGIN, every statement and COMMIT/ROLLBACK
 * on one connection, even while other queries share the pool (#1964).
 *
 * The concurrent `pg_sleep` queries stand in for an app serving traffic: they
 * hold pooled connections, so a pooled `executeQuery` hands the next statement
 * to a different connection than the one that received BEGIN.
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { executeTransaction } from "../migrate";
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

const PG_URL = process.env.TEST_POSTGRES_URL ?? "";
const RUN_ID = randomBytes(4).toString("hex");
const DB_NAME = `nextly_exec_tx_${RUN_ID}`;

describe.skipIf(!PG_URL)("executeTransaction (postgres)", () => {
  let adapter: DrizzleAdapter;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: PG_URL });
    await admin.query(`CREATE DATABASE "${DB_NAME}"`);
    await admin.end();
    const url = new URL(PG_URL);
    url.pathname = `/${DB_NAME}`;
    adapter = (await createAdapter({
      type: "postgresql",
      url: url.toString(),
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  });

  afterAll(async () => {
    await adapter?.disconnect();
    const admin = new Pool({ connectionString: PG_URL });
    await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
    await admin.end();
  });

  const tableExists = async (table: string): Promise<boolean> => {
    const rows = await adapter.executeQuery<{ exists: boolean }>(
      `SELECT to_regclass('${table}') IS NOT NULL AS exists`
    );
    return rows[0].exists;
  };

  const idleInTransaction = async (): Promise<number> => {
    const rows = await adapter.executeQuery<{ n: string }>(
      `SELECT count(*) AS n FROM pg_stat_activity
       WHERE datname = current_database() AND state = 'idle in transaction'`
    );
    return Number(rows[0].n);
  };

  /** A few queries holding pooled connections while the transaction runs. */
  const concurrentLoad = () =>
    Promise.all(
      [1, 2, 3, 4].map(() => adapter.executeQuery("SELECT pg_sleep(0.3)"))
    );

  it("rolls back every statement on failure, under concurrent queries", async () => {
    for (let run = 0; run < 5; run++) {
      const table = `exec_tx_rollback_${run}`;
      const pids = new Set<number>();
      let load: Promise<unknown> = Promise.resolve();

      await expect(
        executeTransaction(adapter, async execute => {
          const [begin] = (await execute("SELECT pg_backend_pid() AS pid")) as {
            pid: number;
          }[];
          pids.add(begin.pid);
          load = concurrentLoad();
          await new Promise(resolve => setTimeout(resolve, 20));
          await execute(`CREATE TABLE ${table} (id int)`);
          const [end] = (await execute("SELECT pg_backend_pid() AS pid")) as {
            pid: number;
          }[];
          pids.add(end.pid);
          await load;
          throw new Error("force rollback");
        })
      ).rejects.toThrow("force rollback");
      await load;

      expect(pids.size).toBe(1);
      expect(await tableExists(table)).toBe(false);
    }
    expect(await idleInTransaction()).toBe(0);
  });

  it("commits every statement on success, under concurrent queries", async () => {
    const table = "exec_tx_commit";
    let load: Promise<unknown> = Promise.resolve();

    await executeTransaction(adapter, async execute => {
      load = concurrentLoad();
      await new Promise(resolve => setTimeout(resolve, 20));
      await execute(`CREATE TABLE ${table} (id int)`);
      await execute(`INSERT INTO ${table} (id) VALUES (1)`);
      await load;
    });

    expect(await tableExists(table)).toBe(true);
    const rows = await adapter.executeQuery<{ n: string }>(
      `SELECT count(*) AS n FROM ${table}`
    );
    expect(Number(rows[0].n)).toBe(1);
    expect(await idleInTransaction()).toBe(0);
  });
});
