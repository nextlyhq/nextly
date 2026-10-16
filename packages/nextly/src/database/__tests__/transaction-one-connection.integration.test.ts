/**
 * A transaction holds one connection, on every dialect and on every path
 * that opens one.
 *
 * A transaction is only atomic when its BEGIN, its statements and its COMMIT
 * or ROLLBACK reach the same database session. On PostgreSQL and MySQL the
 * adapter talks to a pool, so a helper that sends those as separate pooled
 * queries hands each one to whichever connection is free: the BEGIN lands on
 * one, the statements on others, and the ROLLBACK undoes nothing. The
 * connection that received the BEGIN then goes back to the pool still inside
 * its transaction, and whatever request is handed it next writes into a
 * transaction nobody will commit.
 *
 * That only shows while other queries hold connections at the same time, as
 * in any app that is serving traffic: on an idle pool the same free
 * connection tends to be handed out again, and the broken helper looks
 * correct. So every scenario here runs its statements while concurrent
 * queries keep the pool busy, which is the separating condition. Each one
 * then fails on its LAST statement with a real constraint violation and
 * asserts:
 *
 * - every statement ran on the session that ran the first (PostgreSQL and
 *   MySQL; SQLite has one connection by construction);
 * - nothing the transaction wrote survived the rollback;
 * - no session of this database was left idle inside a transaction.
 *
 * The three paths are the ones product code opens a transaction through: the
 * adapter's own `transaction()`, the Drizzle handle's `transaction()` that
 * core services use (`BaseService.withTransaction`), and the migration
 * runner's `executeTransaction`.
 */
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { executeTransaction } from "../../domains/schema/migrate/migration-transaction";
import { describeEachDialect } from "../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { BaseService } from "../../shared/base-service";
import { consoleLogger } from "../../shared/types";

/** The table the scenarios write to, in the instance's own database. */
const TABLE = "tx_one_connection_probe";

/** How many concurrent queries keep the pool busy during a transaction. */
const CONCURRENT_QUERIES = 4;

/** What each scenario's transaction saw, for the assertions. */
interface Observed {
  /** The session id each statement ran on, in order; empty on SQLite. */
  sessions: number[];
}

/** The SQL each dialect needs for the probe. Fixed text, never built from input. */
function dialectSql(dialect: TestDialect): {
  sessionId: string | null;
  busy: string | null;
} {
  switch (dialect) {
    case "postgresql":
      return {
        sessionId: "SELECT pg_backend_pid() AS id",
        busy: "SELECT pg_sleep(0.3)",
      };
    case "mysql":
      return {
        sessionId: "SELECT CONNECTION_ID() AS id",
        busy: "SELECT SLEEP(0.3)",
      };
    case "sqlite":
      // One connection: there is no other session to land on, and a query
      // from another flow would queue behind the transaction, not run beside it.
      return { sessionId: null, busy: null };
  }
}

/** A core service, for the transaction its `withTransaction` opens. */
class ServiceTransaction extends BaseService {
  run<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    return this.withTransaction(work);
  }
}

/**
 * Runs a statement through a Drizzle transaction handle and returns its rows.
 * Each driver's handle answers a raw statement in its own shape.
 */
async function onDrizzle<R>(
  dialect: TestDialect,
  tx: unknown,
  statement: SQL
): Promise<R[]> {
  if (dialect === "postgresql") {
    const result = await (
      tx as { execute(q: SQL): Promise<{ rows: R[] }> }
    ).execute(statement);
    return result.rows;
  }
  if (dialect === "mysql") {
    const [rows] = await (
      tx as { execute(q: SQL): Promise<[R[] | object, unknown]> }
    ).execute(statement);
    return Array.isArray(rows) ? rows : [];
  }
  return await (tx as { all(q: SQL): Promise<R[]> | R[] }).all(statement);
}

describeEachDialect("a transaction holds one connection", dialect => {
  let current: TestNextly;
  const probe = dialectSql(dialect);

  beforeAll(async () => {
    current = await createTestNextly({ dialect });
    await current.adapter.executeQuery(
      `CREATE TABLE ${TABLE} (id INTEGER PRIMARY KEY, label VARCHAR(32) NOT NULL)`
    );
  });

  afterAll(async () => {
    await current.destroy();
  });

  beforeEach(async () => {
    await current.adapter.executeQuery(`DELETE FROM ${TABLE}`);
  });

  /** Concurrent queries holding pooled connections, as live traffic would. */
  function keepPoolBusy(): Promise<unknown> {
    const busy = probe.busy;
    if (busy === null) return Promise.resolve();
    return Promise.all(
      Array.from({ length: CONCURRENT_QUERIES }, () =>
        current.adapter.executeQuery(busy)
      )
    );
  }

  /**
   * Runs one transaction through `open`, which hands the scenario a way to
   * run a statement inside it. Two rows are written, the session is recorded
   * around them, and the last statement repeats a primary key so the
   * database itself fails it.
   */
  async function failOnLastStatement(
    open: (
      work: (run: (statement: string) => Promise<unknown[]>) => Promise<void>
    ) => Promise<void>
  ): Promise<{ observed: Observed; error: unknown }> {
    const observed: Observed = { sessions: [] };
    const sessionId = probe.sessionId;
    let load: Promise<unknown> = Promise.resolve();
    const record = async (
      run: (statement: string) => Promise<unknown[]>
    ): Promise<void> => {
      if (sessionId === null) return;
      const [row] = (await run(sessionId)) as Array<{ id: number | string }>;
      observed.sessions.push(Number(row.id));
    };

    let error: unknown;
    try {
      await open(async run => {
        await record(run);
        load = keepPoolBusy();
        // Let the concurrent queries take their connections first.
        await new Promise(resolve => setTimeout(resolve, 20));
        await run(`INSERT INTO ${TABLE} (id, label) VALUES (1, 'first')`);
        await record(run);
        await run(`INSERT INTO ${TABLE} (id, label) VALUES (2, 'second')`);
        await record(run);
        await run(`INSERT INTO ${TABLE} (id, label) VALUES (1, 'duplicate')`);
      });
    } catch (caught) {
      error = caught;
    }
    await load;
    return { observed, error };
  }

  /** Rows the table holds, read on a fresh pooled connection. */
  async function rowsLeft(): Promise<number> {
    const [row] = await current.adapter.executeQuery<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM ${TABLE}`
    );
    return Number(row.n);
  }

  /**
   * Sessions of this instance's database sitting idle inside a transaction:
   * a connection the pool was handed back without its COMMIT or ROLLBACK.
   */
  async function sessionsIdleInTransaction(): Promise<number> {
    if (dialect === "postgresql") {
      const [row] = await current.adapter.executeQuery<{ n: number | string }>(
        "SELECT COUNT(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'"
      );
      return Number(row.n);
    }
    if (dialect === "mysql") {
      // performance_schema rather than information_schema.innodb_trx: InnoDB
      // registers a transaction only at its first statement, so a session
      // abandoned straight after its BEGIN is invisible there, and still
      // inside a transaction for whoever is handed it next.
      const [row] = await current.adapter.executeQuery<{ n: number | string }>(
        "SELECT COUNT(*) AS n FROM performance_schema.events_transactions_current t JOIN performance_schema.threads th ON th.THREAD_ID = t.THREAD_ID WHERE th.PROCESSLIST_DB = DATABASE() AND th.PROCESSLIST_COMMAND = 'Sleep' AND t.STATE = 'ACTIVE'"
      );
      return Number(row.n);
    }
    // One connection, and the adapter's own probe is what reports one left
    // open on it.
    return current.adapter.transactionOpenInFlow() ? 1 : 0;
  }

  async function expectRolledBackOnOneSession(outcome: {
    observed: Observed;
    error: unknown;
  }): Promise<void> {
    // The duplicate key is the database's own refusal, not the test's.
    expect(outcome.error).toBeDefined();
    if (probe.sessionId !== null) {
      expect(outcome.observed.sessions).toHaveLength(3);
      expect(new Set(outcome.observed.sessions).size).toBe(1);
    }
    expect(await rowsLeft()).toBe(0);
    expect(await sessionsIdleInTransaction()).toBe(0);
  }

  it("sees a session idle inside a transaction while one is open", async () => {
    // The positive control for the check every other test ends on: a
    // detector that never finds anything would pass them all. While the
    // callback waits on another connection, its own session sits idle
    // inside the open transaction, and the detector must count exactly it.
    const seen = await current.adapter.transaction(async ctx => {
      await ctx.execute(`INSERT INTO ${TABLE} (id, label) VALUES (9, 'open')`);
      return sessionsIdleInTransaction();
    });

    expect(seen).toBe(1);
    expect(await sessionsIdleInTransaction()).toBe(0);
  });

  it("the adapter's transaction runs every statement on one session and rolls all of them back", async () => {
    const outcome = await failOnLastStatement(work =>
      current.adapter.transaction(ctx =>
        work(statement => ctx.execute(statement))
      )
    );

    await expectRolledBackOnOneSession(outcome);
  });

  it("a core service's transaction runs every statement on one session and rolls all of them back", async () => {
    const service = new ServiceTransaction(current.adapter, consoleLogger);

    const outcome = await failOnLastStatement(work =>
      service.run(tx =>
        work(statement => onDrizzle(dialect, tx, sql.raw(statement)))
      )
    );

    await expectRolledBackOnOneSession(outcome);
  });

  it("a migration unit's transaction runs every statement on one session and rolls all of them back", async () => {
    const outcome = await failOnLastStatement(work =>
      executeTransaction(current.adapter, tx =>
        work(statement => onDrizzle(dialect, tx.db, sql.raw(statement)))
      )
    );

    await expectRolledBackOnOneSession(outcome);
  });

  it("a migration unit's statements and the reads beside them share the unit's session", async () => {
    // The migration runner's `execute` is the path the units' DDL and DML
    // take; `db` is the handle its ledger writes take. Both must be the
    // unit's session, or a failed unit leaves its ledger row or its
    // statements behind.
    const outcome = await failOnLastStatement(work =>
      executeTransaction(current.adapter, tx =>
        work(async statement => {
          if (statement.startsWith("SELECT")) {
            return onDrizzle(dialect, tx.db, sql.raw(statement));
          }
          await tx.execute(statement);
          return [];
        })
      )
    );

    await expectRolledBackOnOneSession(outcome);
  });

  it.runIf(dialect === "mysql")(
    "hands its connection back with the session's own lock wait timeout",
    async () => {
      // MySQL's lock wait timeout has no transaction-scoped form, so a
      // transaction's own timeout is set on the session; the session must
      // have its own value back before the pool hands it to anyone else.
      // Read by connection id, so it is that session's value, whichever
      // pooled connection the read itself runs on.
      const readTimeout = async (session: number): Promise<number> => {
        const [row] = await current.adapter.executeQuery<{
          value: string | number;
        }>(
          "SELECT v.VARIABLE_VALUE AS value FROM performance_schema.variables_by_thread v JOIN performance_schema.threads t ON t.THREAD_ID = v.THREAD_ID WHERE t.PROCESSLIST_ID = ? AND v.VARIABLE_NAME = 'innodb_lock_wait_timeout'",
          [session]
        );
        return Number(row.value);
      };
      const [global] = await current.adapter.executeQuery<{
        value: string | number;
      }>("SELECT @@GLOBAL.innodb_lock_wait_timeout AS value");

      let session = 0;
      let during = 0;
      await current.adapter.transaction(
        async ctx => {
          const [row] = await ctx.execute<{ id: number | string }>(
            "SELECT CONNECTION_ID() AS id"
          );
          session = Number(row.id);
          during = await readTimeout(session);
        },
        { timeoutMs: 7000 }
      );

      // The transaction did change it, so the check below can tell.
      expect(during).toBe(7);
      expect(Number(global.value)).not.toBe(7);
      expect(await readTimeout(session)).toBe(Number(global.value));
    }
  );

  it("leaves the pool usable: a later transaction commits on a clean session", async () => {
    await failOnLastStatement(work =>
      current.adapter.transaction(ctx =>
        work(statement => ctx.execute(statement))
      )
    );

    await current.adapter.transaction(async ctx => {
      await ctx.execute(`INSERT INTO ${TABLE} (id, label) VALUES (3, 'kept')`);
    });

    expect(await rowsLeft()).toBe(1);
    expect(await sessionsIdleInTransaction()).toBe(0);
  });
});
