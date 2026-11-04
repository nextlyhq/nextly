// A transaction opened inside another's work joins it on PostgreSQL: it runs
// on the outer's connection, as a savepoint, and what it registers to run
// after commit waits for the outermost commit.
//
// Every way a transaction opens is covered, nested in every other way:
// the adapter's `transaction`, the Drizzle handle's `transaction`, and
// Drizzle's own `tx.transaction` inside the handle's. A call on a second
// connection is told apart by its backend's process id, and by a lock: the
// outer holds a row, and the inner writes it, which on a second connection
// waits for the outer, which waits for the inner. The wait is bounded, so
// such a run fails rather than hangs.
//
// Self-skips when TEST_POSTGRES_URL is unset.

import { sql, type SQL } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { createPostgresAdapter, type PostgresAdapter } from "../index";

const TABLE = "int_txpg_joins_outer";
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

/** A serialization failure raised on purpose, as a lost race reports one. */
const FORCED_CONFLICT =
  "DO $$ BEGIN RAISE EXCEPTION 'a forced conflict' USING ERRCODE = '40001'; END $$";

/** Runs one statement in whatever transaction handle it was made for. */
type Exec = (text: string) => Promise<Record<string, unknown>[]>;

/** Opens a transaction and hands its work a way to run statements, and to open one nested Drizzle's own way. */
type Opener = (
  work: (exec: Exec, own: Opener) => Promise<void>
) => Promise<void>;

/** The Drizzle handle, as far as these tests use it. */
interface DrizzleHandle {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
  transaction<T>(work: (tx: DrizzleHandle) => Promise<T>): Promise<T>;
}

/** Rejects once `seconds` pass, so a transaction waiting on a lock fails the test instead of hanging it. */
class WaitedOnTheOuter extends Error {}

function within<T>(seconds: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new WaitedOnTheOuter(
            `The inner transaction waited ${String(seconds)} s on the outer's lock: it ran on another connection.`
          )
        ),
      seconds * 1000
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

describe("PostgreSQL: a transaction opened inside another joins it", async () => {
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
  });

  beforeEach(async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
    await adapter.executeQuery(`INSERT INTO ${TABLE} (id) VALUES ('seed')`);
  });

  afterAll(async () => {
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.disconnect();
  });

  const viaContext =
    (ctx: TransactionContext): Exec =>
    text =>
      ctx.execute<Record<string, unknown>>(text);
  const viaDrizzle =
    (tx: DrizzleHandle): Exec =>
    async text =>
      (await tx.execute(sql.raw(text))).rows;

  const ownOf =
    (tx: DrizzleHandle): Opener =>
    work =>
      tx.transaction(inner => work(viaDrizzle(inner), ownOf(inner)));
  const throughAdapter: Opener = work =>
    adapter.transaction(ctx => work(viaContext(ctx), throughAdapter));
  const throughHandle: Opener = work =>
    adapter
      .getDrizzle<DrizzleHandle>()
      .transaction(tx => work(viaDrizzle(tx), ownOf(tx)));

  const WAYS: Array<[string, Opener, (own: Opener) => Opener]> = [
    [
      "adapter.transaction in adapter.transaction",
      throughAdapter,
      () => throughAdapter,
    ],
    [
      "the Drizzle handle's transaction in adapter.transaction",
      throughAdapter,
      () => throughHandle,
    ],
    [
      "adapter.transaction in the Drizzle handle's",
      throughHandle,
      () => throughAdapter,
    ],
    [
      "Drizzle's own tx.transaction in the Drizzle handle's",
      throughHandle,
      own => own,
    ],
  ];

  const stored = async (): Promise<string[]> =>
    (
      await adapter.executeQuery<{ id: string }>(
        `SELECT id FROM ${TABLE} ORDER BY id`
      )
    ).map(row => row.id);

  /** Counts `id` from a connection of its own, which sees only committed rows. */
  const committed = async (id: string): Promise<number> => {
    const client = new pg.Client({ connectionString: TEST_DB_URL });
    await client.connect();
    try {
      const result = await client.query(
        `SELECT id FROM ${TABLE} WHERE id = $1`,
        [id]
      );
      return result.rowCount ?? 0;
    } finally {
      await client.end();
    }
  };

  const pid = async (exec: Exec): Promise<unknown> =>
    (await exec("SELECT pg_backend_pid() AS pid"))[0]?.pid;

  it.each(WAYS)(
    "a transaction opened inside another runs on its connection: %s",
    async (_way, outer, inner) => {
      let outerPid: unknown;
      let innerPid: unknown;
      let innerSaw = -1;
      await outer(async (exec, own) => {
        outerPid = await pid(exec);
        await exec(`SELECT id FROM ${TABLE} WHERE id = 'seed' FOR UPDATE`);
        await exec(`INSERT INTO ${TABLE} (id) VALUES ('uncommitted')`);
        await within(
          3,
          inner(own)(async innerExec => {
            innerPid = await pid(innerExec);
            innerSaw = (
              await innerExec(
                `SELECT id FROM ${TABLE} WHERE id = 'uncommitted'`
              )
            ).length;
            await innerExec(`UPDATE ${TABLE} SET n = n + 1 WHERE id = 'seed'`);
          })
        );
      });

      expect(innerPid).toBe(outerPid);
      expect(innerSaw).toBe(1);
      expect(await stored()).toEqual(["seed", "uncommitted"]);
    }
  );

  it.each(WAYS)(
    "an inner part's failure undoes only that part: %s",
    async (_way, outer, inner) => {
      await outer(async (exec, own) => {
        await exec(`INSERT INTO ${TABLE} (id) VALUES ('a')`);
        await within(
          3,
          inner(own)(async innerExec => {
            await innerExec(`INSERT INTO ${TABLE} (id) VALUES ('b')`);
            // A duplicate of the outer's own uncommitted row: on the outer's
            // connection a unique violation at once, which aborts the part.
            await innerExec(`INSERT INTO ${TABLE} (id) VALUES ('a')`);
          })
        ).catch((error: unknown) => {
          if (error instanceof WaitedOnTheOuter) throw error;
        });
        await exec(`INSERT INTO ${TABLE} (id) VALUES ('c')`);
      });

      expect(await stored()).toEqual(["a", "c", "seed"]);
    }
  );

  it.each(WAYS)(
    "runs a joined part's commit callbacks once, in order, after the outermost commit: %s",
    async (_way, outer, inner) => {
      const ran: string[] = [];
      const failures: unknown[] = [];
      let ranBeforeCommit: string[] = [];
      let seenFromAnotherConnection = -1;
      await outer(async (_exec, own) => {
        await within(
          3,
          inner(own)(async innerExec => {
            await innerExec(`INSERT INTO ${TABLE} (id) VALUES ('announced')`);
            await adapter.afterCommit(async () => {
              seenFromAnotherConnection = await committed("announced");
              ran.push("first");
            });
            await adapter.afterCommit(
              () => {
                ran.push("second");
                throw new Error("a held effect that fails");
              },
              error => failures.push(error)
            );
            await adapter.afterCommit(() => ran.push("third"));
          })
        );
        ranBeforeCommit = [...ran];
      });

      expect(ranBeforeCommit).toEqual([]);
      expect(ran).toEqual(["first", "second", "third"]);
      expect(seenFromAnotherConnection).toBe(1);
      expect(failures).toHaveLength(1);
    }
  );

  it("runs a retried transaction's commit callback once, for the attempt that committed", async () => {
    let attempt = 0;
    const ran: string[] = [];
    await adapter.transaction(
      async ctx => {
        attempt += 1;
        const at = attempt;
        await adapter.afterCommit(() => ran.push(`commit ${String(at)}`));
        if (at === 1) {
          await ctx.execute(FORCED_CONFLICT);
        }
      },
      { retryCount: 1, retryDelayMs: 1 }
    );

    expect(ran).toEqual(["commit 2"]);
  });

  it("drops a retried attempt's rollback callback when a later attempt commits", async () => {
    let attempt = 0;
    const ran: string[] = [];
    await adapter.transaction(
      async ctx => {
        attempt += 1;
        const at = attempt;
        await adapter.afterRollback(() => ran.push(`rollback ${String(at)}`));
        await adapter.afterCommit(() => ran.push(`commit ${String(at)}`));
        if (at === 1) await ctx.execute(FORCED_CONFLICT);
      },
      { retryCount: 1, retryDelayMs: 1 }
    );

    expect(ran).toEqual(["commit 2"]);
  });

  it("runs a rollback callback once, after the last attempt has rolled back", async () => {
    let attempt = 0;
    const ran: string[] = [];
    let ranBeforeTheEnd: string[] = [];
    const outcome = await adapter
      .transaction(
        async ctx => {
          attempt += 1;
          const at = attempt;
          ranBeforeTheEnd = [...ran];
          await adapter.afterRollback(() => ran.push(`rollback ${String(at)}`));
          await ctx.execute(FORCED_CONFLICT);
        },
        { retryCount: 1, retryDelayMs: 1 }
      )
      .then(
        () => "committed",
        () => "rolled back"
      );

    expect(outcome).toBe("rolled back");
    expect(attempt).toBe(2);
    expect(ranBeforeTheEnd).toEqual([]);
    expect(ran).toEqual(["rollback 2"]);
  });

  it("retries an application error when retryWhen accepts it, before passing it through", async () => {
    // Branded as the application's own refusal, which is otherwise never retried.
    const conflict = Object.assign(new Error("a version conflict"), {
      [Symbol.for("nextly/NextlyError")]: true,
    });
    let attempt = 0;
    const result = await adapter.transaction(
      async () => {
        attempt += 1;
        if (attempt === 1) throw conflict;
        return "second attempt";
      },
      { retryCount: 2, retryDelayMs: 1, retryWhen: error => error === conflict }
    );
    const refused = await adapter
      .transaction(
        async () => {
          throw conflict;
        },
        { retryCount: 2, retryDelayMs: 1 }
      )
      .catch((error: unknown) => error);

    expect(result).toBe("second attempt");
    expect(attempt).toBe(2);
    // Without retryWhen the same error arrives as thrown, untried again.
    expect(refused).toBe(conflict);
  });
});
