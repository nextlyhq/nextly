/**
 * A request waits a bounded time for a database connection, and past the
 * bound fails as "database busy": retryable, and never a validation,
 * permission or internal error.
 *
 * Each dialect's adapter is built with a one-connection pool and a short
 * `pool.connectionTimeoutMs`, and one transaction holds that connection
 * open. Every other request then has to wait for it, which is the
 * separating condition: with a free connection a request never waits, and a
 * missing bound looks exactly like a working one. Each case asserts:
 *
 * - the waiting request failed after the bound, not before it and not long
 *   after it;
 * - the failure reaches a caller as DATABASE_BUSY, with a retry hint, and
 *   leaves REST as 503 with a Retry-After header;
 * - nothing the waiting request meant to write was written;
 * - no session was left inside a transaction, and the pool serves the next
 *   request once the holder is done.
 *
 * On SQLite there is one connection and no pool: the wait is the adapter's
 * own queue of transactions, which the same setting bounds. A second process
 * holding the database file is the other wait there, bounded by
 * `busyTimeout`, and it fails as DATABASE_BUSY too.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withErrorHandler } from "../../api/with-error-handler";
import { NextlyError } from "../../errors";
import { toDbError } from "../errors";
import { createAdapter } from "../factory";

import { makeTestContext } from "./integration/helpers/test-db";

/** The bound each case waits against: short, so a case stays well inside the suite timeout. */
const BOUND_MS = 1000;
/** How far past the bound a failure may arrive: timer and round-trip latency, not a second wait. */
const LATE_MS = 4000;

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** Runs `work` and returns what it threw, with how long it took to throw. */
async function failure(
  work: () => Promise<unknown>
): Promise<{ error: unknown; elapsed: number }> {
  const started = Date.now();
  try {
    await work();
  } catch (error) {
    return { error, elapsed: Date.now() - started };
  }
  throw new Error("expected the request to fail, and it succeeded");
}

async function expectBusy(
  dialect: SupportedDialect,
  outcome: { error: unknown; elapsed: number },
  bound: number
): Promise<void> {
  // After the bound: a request refused at once was never waiting for it.
  expect(outcome.elapsed).toBeGreaterThanOrEqual(bound - 50);
  expect(outcome.elapsed).toBeLessThan(bound + LATE_MS);

  // A service that converts its database errors, as `withDbErrors` and the
  // services catching them do.
  const converted = NextlyError.fromDatabaseError(
    toDbError(dialect, outcome.error)
  );
  expect(converted.code).toBe("DATABASE_BUSY");
  expect(converted.statusCode).toBe(503);
  expect(converted.publicData).toEqual({ retryAfterSeconds: 5 });

  // A service that does not: the error arrives raw at the boundary answering
  // the request, which is what a real REST route sees.
  const route = withErrorHandler(async (_request: Request) => {
    throw outcome.error;
  });
  const response = await route(new Request("http://localhost/api/busy"));
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("5");
  const body = (await response.json()) as {
    error: { code: string; message: string };
  };
  expect(body.error.code).toBe("DATABASE_BUSY");
  // The generic sentence, never the driver's.
  expect(body.error.message).toBe(
    "The database is busy. Please try again shortly."
  );
}

for (const dialect of DIALECTS) {
  const context = makeTestContext(dialect);
  const table = `${context.prefix}_busy_probe`;

  describe.skipIf(!context.available)(
    `a request waiting for a connection on ${dialect}`,
    () => {
      let adapter: DrizzleAdapter;
      let folder: string | undefined;
      let sqliteUrl: string | undefined;

      beforeAll(async () => {
        if (dialect === "sqlite") {
          // A file rather than memory, so a second connection can open it.
          folder = mkdtempSync(join(tmpdir(), "nextly-busy-"));
          sqliteUrl = `file:${join(folder, "busy.db")}`;
        }
        adapter = (await createAdapter({
          type: dialect,
          url: sqliteUrl ?? context.url ?? undefined,
          pool: { max: 1, connectionTimeoutMs: BOUND_MS },
        })) as DrizzleAdapter;
        await adapter.executeQuery(
          `CREATE TABLE ${table} (id INTEGER PRIMARY KEY, label VARCHAR(32) NOT NULL)`
        );
      });

      afterAll(async () => {
        await adapter?.executeQuery(`DROP TABLE IF EXISTS ${table}`);
        await adapter?.disconnect();
        if (folder) rmSync(folder, { recursive: true, force: true });
      });

      beforeEach(async () => {
        await adapter.executeQuery(`DELETE FROM ${table}`);
      });

      /**
       * A transaction holding the pool's one connection until `release` is
       * called, having written row 1. `done` settles once it has committed.
       */
      async function holdTheConnection(): Promise<{
        release: () => void;
        done: Promise<unknown>;
      }> {
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        // Released anyway once a bounded wait is long over: a request that is
        // NOT bounded then gets the connection and succeeds, which fails its
        // own case by name instead of holding every later case behind it.
        const safety = setTimeout(() => release(), BOUND_MS + LATE_MS + 1000);
        void gate.then(() => clearTimeout(safety));
        let opened!: () => void;
        const isOpen = new Promise<void>(resolve => (opened = resolve));
        const done = adapter.transaction(async ctx => {
          await ctx.execute(
            `INSERT INTO ${table} (id, label) VALUES (1, 'holder')`
          );
          opened();
          await gate;
        });
        await isOpen;
        return { release, done };
      }

      async function ids(): Promise<number[]> {
        const rows = await adapter.executeQuery<{ id: number | string }>(
          `SELECT id FROM ${table} ORDER BY id`
        );
        return rows.map(row => Number(row.id));
      }

      /**
       * Sessions of this database left idle inside a transaction: a connection
       * handed back without its COMMIT or ROLLBACK.
       */
      async function sessionsIdleInTransaction(): Promise<number> {
        if (dialect === "postgresql") {
          const [row] = await adapter.executeQuery<{ n: number | string }>(
            "SELECT COUNT(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'"
          );
          return Number(row.n);
        }
        if (dialect === "mysql") {
          const [row] = await adapter.executeQuery<{ n: number | string }>(
            "SELECT COUNT(*) AS n FROM performance_schema.events_transactions_current t JOIN performance_schema.threads th ON th.THREAD_ID = t.THREAD_ID WHERE th.PROCESSLIST_DB = DATABASE() AND th.PROCESSLIST_COMMAND = 'Sleep' AND t.STATE = 'ACTIVE'"
          );
          return Number(row.n);
        }
        return adapter.transactionOpenInFlow() ? 1 : 0;
      }

      it("a transaction that waits past the bound fails as database busy, writes nothing, and leaves no transaction open", async () => {
        const holder = await holdTheConnection();
        const outcome = await failure(() =>
          adapter.transaction(ctx =>
            ctx.execute(
              `INSERT INTO ${table} (id, label) VALUES (2, 'waiting')`
            )
          )
        );
        holder.release();
        await holder.done;

        await expectBusy(dialect, outcome, BOUND_MS);
        expect(await ids()).toEqual([1]);
        expect(await sessionsIdleInTransaction()).toBe(0);
        // The pool serves the next request: a connection that arrived for
        // the abandoned wait went back rather than staying held.
        await adapter.executeQuery(
          `INSERT INTO ${table} (id, label) VALUES (3, 'after')`
        );
        expect(await ids()).toEqual([1, 3]);
      });

      it.skipIf(dialect === "sqlite")(
        "a statement that waits past the bound fails as database busy and writes nothing",
        async () => {
          const holder = await holdTheConnection();
          const outcome = await failure(() =>
            adapter.executeQuery(
              `INSERT INTO ${table} (id, label) VALUES (2, 'waiting')`
            )
          );
          // Gone from the pool's queue while the holder still has the
          // connection: a pool that stays saturated must not keep every
          // request that already failed.
          expect(adapter.getPoolStats()?.waiting).toBe(0);
          holder.release();
          await holder.done;

          await expectBusy(dialect, outcome, BOUND_MS);
          expect(await ids()).toEqual([1]);
          expect(await sessionsIdleInTransaction()).toBe(0);
        }
      );

      it.skipIf(dialect === "sqlite")(
        "a query through the Drizzle handle that waits past the bound fails as database busy",
        async () => {
          // The handle core services query through, which reaches the pool
          // without the adapter's own statement path.
          const db = adapter.getDrizzle<{
            execute(query: unknown): Promise<unknown>;
          }>();
          const { sql } = await import("drizzle-orm");
          const holder = await holdTheConnection();
          const outcome = await failure(() =>
            db.execute(
              sql.raw(`INSERT INTO ${table} (id, label) VALUES (2, 'waiting')`)
            )
          );
          holder.release();
          await holder.done;

          await expectBusy(dialect, outcome, BOUND_MS);
          expect(await ids()).toEqual([1]);
        }
      );

      it.skipIf(dialect !== "sqlite")(
        "a write blocked by another process holding the file fails as database busy",
        async () => {
          const busyTimeout = 300;
          const other = (await createAdapter({
            type: "sqlite",
            url: sqliteUrl,
            busyTimeout,
          } as Parameters<typeof createAdapter>[0])) as DrizzleAdapter;
          try {
            const holder = await holdTheConnection();
            const outcome = await failure(() =>
              other.executeQuery(
                `INSERT INTO ${table} (id, label) VALUES (2, 'other')`
              )
            );
            holder.release();
            await holder.done;

            await expectBusy(dialect, outcome, busyTimeout);
            expect(await ids()).toEqual([1]);
          } finally {
            await other.disconnect();
          }
        }
      );
    }
  );
}
