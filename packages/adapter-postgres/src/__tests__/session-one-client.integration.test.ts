// `withSession` runs its statements outside a transaction on ONE pooled client, held for the whole
// of the work, so connection-scoped state a statement sets (a temporary table, a session setting)
// is still there for the next.
//
// A pool of two clients makes a split observable: a query run on the pool while the session is
// open takes the client the session's previous statement released, if the session holds none, and
// the session's next statement then lands on the other client.
//
// Self-skips when TEST_POSTGRES_URL is unset.

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresAdapter, type PostgresAdapter } from "../index";

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

describe("PostgreSQL withSession", async () => {
  const available = TEST_DB_URL ? await canConnect(TEST_DB_URL) : false;

  if (!available) {
    it.skip("Skipping: TEST_POSTGRES_URL not set or unreachable", () => {});
    return;
  }

  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = createPostgresAdapter({ url: TEST_DB_URL, pool: { max: 2 } });
    await adapter.connect();
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it("runs every statement on the one client it holds, while the pool serves other queries", async () => {
    const pids = await adapter.withSession(async session => {
      const [first] = await session.execute<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid"
      );
      // The pool's other query starts while the session is open, on whatever client is idle.
      const elsewhere = adapter.executeQuery("SELECT pg_sleep(0.3)");
      const [second] = await session.execute<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid"
      );
      await elsewhere;
      return [first.pid, second.pid];
    });
    expect(pids[1]).toBe(pids[0]);
  });

  it("keeps connection-scoped state from one statement to the next", async () => {
    const rows = await adapter.withSession(async session => {
      await session.execute(
        "CREATE TEMP TABLE int_pg_session_scratch (v text)"
      );
      const elsewhere = adapter.executeQuery("SELECT pg_sleep(0.3)");
      await session.execute(
        "INSERT INTO int_pg_session_scratch (v) VALUES ('kept')"
      );
      await elsewhere;
      return session.execute<{ v: string }>(
        "SELECT v FROM int_pg_session_scratch"
      );
    });
    expect(rows).toEqual([{ v: "kept" }]);
  });

  it("closes the session's client instead of pooling it, so nothing the session set reaches a later caller", async () => {
    const one = createPostgresAdapter({ url: TEST_DB_URL, pool: { max: 1 } });
    await one.connect();
    try {
      const [before] = await one.executeQuery<{ name: string }>(
        "SELECT current_setting('application_name') AS name"
      );
      const work = async () =>
        one.withSession(async session => {
          await session.execute(
            "CREATE TEMP TABLE int_pg_session_leftover (v text)"
          );
          await session.execute("SET application_name = 'leftover'");
          const [row] = await session.execute<{ pid: number }>(
            "SELECT pg_backend_pid() AS pid"
          );
          return row.pid;
        });
      const sessionPid = await work();
      // The pool's only slot holds a new client: the session's is gone, and with it the temporary
      // table and the setting.
      const [after] = await one.executeQuery<{ name: string; pid: number }>(
        "SELECT current_setting('application_name') AS name, pg_backend_pid() AS pid"
      );
      expect(after.pid).not.toBe(sessionPid);
      expect(after.name).toBe(before.name);
      await work();
    } finally {
      await one.disconnect();
    }
  });

  it("is refused inside an open transaction, running nothing", async () => {
    await expect(
      adapter.transaction(async () => {
        await adapter.withSession(async session => {
          await session.execute("SELECT 1");
        });
      })
    ).rejects.toMatchObject({ code: "NEXTLY_SESSION_INSIDE_TRANSACTION" });
  });
});
