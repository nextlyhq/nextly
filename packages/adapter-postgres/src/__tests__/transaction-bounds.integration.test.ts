// Transactions opened inside `withTransactionBounds` are bounded by the
// server, so one can never hold its locks for long after its process stops
// running: a serverless platform freezes a function once its response is
// sent, and a transaction background work had open then stays open, idle,
// with its locks, until the function runs again.
//
// - A lock such a transaction waits for longer than `lockWaitMs` fails the
//   statement waiting for it, rather than waiting until the statement
//   timeout (or for ever, with none).
// - Such a transaction left idle for longer than `idleMs` is ended by the
//   server, which rolls it back and releases its locks, and the process that
//   held it is not brought down when it runs again: its next statement fails.
// - A transaction opened outside the scope is bounded by neither: the
//   controls, waiting and holding as before.
//
// Self-skips when TEST_POSTGRES_URL is unset.

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresAdapter, type PostgresAdapter } from "../index";

const TABLE = "int_txpg_bounds";
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

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/** How `work` settled, and how long it took, never waiting past `capMs`. */
async function settledWithin(
  work: Promise<unknown>,
  capMs: number
): Promise<{ outcome: "resolved" | "rejected" | "still waiting"; ms: number }> {
  const started = Date.now();
  const outcome = await Promise.race([
    work.then(
      () => "resolved" as const,
      () => "rejected" as const
    ),
    sleep(capMs).then(() => "still waiting" as const),
  ]);
  return { outcome, ms: Date.now() - started };
}

describe("PostgreSQL transactions opened inside withTransactionBounds", async () => {
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
    await adapter.executeQuery(
      `CREATE TABLE ${TABLE} (id text PRIMARY KEY, n integer NOT NULL DEFAULT 0)`
    );
    await adapter.executeQuery(`INSERT INTO ${TABLE} (id) VALUES ('a'), ('b')`);
  });

  afterAll(async () => {
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.disconnect();
  });

  /** A connection of the test's own holding row `id` locked until released. */
  async function holdRow(
    id: string
  ): Promise<{ release: () => Promise<void> }> {
    const client = new pg.Client({ connectionString: TEST_DB_URL });
    await client.connect();
    await client.query("BEGIN");
    await client.query(`SELECT id FROM ${TABLE} WHERE id = $1 FOR UPDATE`, [
      id,
    ]);
    return {
      release: async () => {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.end().catch(() => undefined);
      },
    };
  }

  /** An update of row `id` on a connection of the test's own, waiting at most `ms` for its lock. */
  async function updateOnItsOwn(id: string, ms: number): Promise<void> {
    const client = new pg.Client({ connectionString: TEST_DB_URL });
    await client.connect();
    try {
      await client.query(`SET lock_timeout = ${ms}`);
      await client.query(`UPDATE ${TABLE} SET n = n + 1 WHERE id = $1`, [id]);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  const updateIn = (id: string) =>
    adapter.transaction(async tx => {
      await tx.execute(`UPDATE ${TABLE} SET n = n + 1 WHERE id = $1`, [id]);
    });

  it("fails a statement waiting longer than lockWaitMs for a lock, where one outside the scope waits on", async () => {
    const holder = await holdRow("a");
    try {
      const bounded = await settledWithin(
        adapter.withTransactionBounds({ lockWaitMs: 300 }, () => updateIn("a")),
        5000
      );
      expect(bounded.outcome).toBe("rejected");
      expect(bounded.ms).toBeLessThan(3000);

      // The control: the same update outside the scope is still waiting.
      const unbounded = updateIn("a");
      unbounded.catch(() => undefined);
      expect((await settledWithin(unbounded, 1500)).outcome).toBe(
        "still waiting"
      );
      await holder.release();
      expect((await settledWithin(unbounded, 5000)).outcome).toBe("resolved");
    } finally {
      await holder.release();
    }
  });

  it("has the server end a transaction left idle longer than idleMs, releasing its locks", async () => {
    let frozenDone: () => void = () => undefined;
    const frozen = new Promise<void>(resolve => {
      frozenDone = resolve;
    });
    const stuck = adapter.withTransactionBounds({ idleMs: 300 }, () =>
      adapter.transaction(async tx => {
        await tx.execute(`UPDATE ${TABLE} SET n = n + 1 WHERE id = $1`, ["b"]);
        // Frozen: no statement runs until the process is thawed.
        await frozen;
        await tx.execute("SELECT 1");
      })
    );
    stuck.catch(() => undefined);
    try {
      await sleep(1200);
      // The row the idle transaction locked is free again.
      await expect(updateOnItsOwn("b", 2000)).resolves.toBeUndefined();
    } finally {
      // Thawed, whatever was found: never left holding the row for the next test.
      frozenDone();
    }
    // Its next statement fails, and the process carries on.
    expect((await settledWithin(stuck, 5000)).outcome).toBe("rejected");
    // The adapter still answers on a connection of its own.
    await expect(updateIn("b")).resolves.toBeUndefined();
  });

  it("leaves an idle transaction outside the scope holding its locks", async () => {
    let thaw: () => void = () => undefined;
    const thawed = new Promise<void>(resolve => {
      thaw = resolve;
    });
    const idle = adapter.transaction(async tx => {
      await tx.execute(`UPDATE ${TABLE} SET n = n + 1 WHERE id = $1`, ["b"]);
      await thawed;
    });
    try {
      await sleep(1200);
      await expect(updateOnItsOwn("b", 500)).rejects.toThrow();
    } finally {
      thaw();
      await idle;
    }
  });

  it("bounds only the transactions opened inside the scope", async () => {
    const holder = await holdRow("a");
    try {
      await adapter.withTransactionBounds({ lockWaitMs: 300 }, async () => {
        await Promise.resolve();
      });
      const after = updateIn("a");
      after.catch(() => undefined);
      expect((await settledWithin(after, 1500)).outcome).toBe("still waiting");
      await holder.release();
      await after;
    } finally {
      await holder.release();
    }
  });
});
