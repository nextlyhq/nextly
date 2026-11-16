/**
 * What a MySQL unit in one transaction keeps when a try ends, read against a stand-in adapter:
 * where the next try starts after a wait in a statement's checkpoint, before the statement was
 * sent, and how the statements after a schema statement's implicit commit are kept together.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it } from "vitest";

import type { BusyTableBounds } from "../bounds";
import { runMigrationStatements } from "../../migrate/migration-transaction";
import { runUnitInTries } from "../run-unit";

const BOUNDS: BusyTableBounds = { tryMs: 100, totalMs: 1_500 };

/** MySQL's `lock_wait_timeout` running out. */
function mysqlLockWaitTimeout(): Error {
  return Object.assign(new Error("Lock wait timeout exceeded"), {
    code: "ER_LOCK_WAIT_TIMEOUT",
    errno: 1205,
  });
}

/**
 * A MySQL stand-in whose transactions record every statement sent (`sent`, without the try's
 * session settings); `failStatement` and `failRead` throw for a statement or a checkpoint read
 * they want to wait, by how often each was asked before.
 */
function mysqlAdapter(options: {
  failStatement?: (statement: string, sentBefore: number) => Error | undefined;
  /** For the checkpoint's reads of the catalog's tables. */
  failRead?: (readsBefore: number) => Error | undefined;
}) {
  const sent: string[] = [];
  let reads = 0;
  const adapter = {
    getCapabilities: () => ({ dialect: "mysql" as const }),
    transactionOpenInFlow: () => false,
    // The grant check finds TRIGGER on the database; the trigger list, the watch's polls and the
    // holder's read find nothing.
    queryStatement: (query: unknown) =>
      Promise.resolve(
        JSON.stringify(query).includes("USER_PRIVILEGES") ? [{ seen: 1 }] : []
      ),
    executeQuery: () => Promise.resolve([]),
    getDrizzle: () => ({}),
    transaction: <T>(work: (ctx: unknown) => Promise<T>): Promise<T> =>
      work({
        execute: (statement: string) => {
          if (
            /^SET SESSION (lock_wait|innodb_lock_wait)_timeout/.test(statement)
          ) {
            return Promise.resolve([]);
          }
          const sentBefore = sent.filter(s => s === statement).length;
          sent.push(statement);
          const error = options.failStatement?.(statement, sentBefore);
          return error === undefined
            ? Promise.resolve([])
            : Promise.reject(error);
        },
        queryStatement: () => Promise.resolve([{ session_id: 7 }]),
        getDrizzle: () => ({
          // The checkpoint's reads: the column's facts, then its null rows (none).
          execute: (query: unknown) => {
            // Only the reads of the catalog's tables count: the checkpoint's own.
            if (!JSON.stringify(query).includes("information_schema.TABLES")) {
              return Promise.resolve([[], []]);
            }
            const error = options.failRead?.(reads);
            reads += 1;
            return error === undefined
              ? Promise.resolve([[{ n: 0, count: 0 }], []])
              : Promise.reject(error);
          },
        }),
      }),
  };
  return { adapter: adapter as unknown as DrizzleAdapter, sent };
}

const run = {
  bounds: BOUNDS,
  notify: () => {},
  appliedBefore: () => [],
};

const unit = { source: "0001_test.sql", transaction: true };

describe("runMigrationStatements on MySQL after a schema statement's implicit commit", () => {
  it("moves the watch past the statement and settles a cancel under way before the transaction opens again", async () => {
    const events: string[] = [];
    const create = "CREATE TABLE helper (id int)";
    const count = "UPDATE counters SET n = n + 1";
    const { adapter } = mysqlAdapter({
      failStatement: statement => {
        events.push(statement);
        return undefined;
      },
    });

    await runMigrationStatements(adapter, [create, count], unit, undefined, {
      tryMs: 1_000,
      onStatement: index => events.push(`at ${String(index)}`),
      beforeStatement: () => {
        events.push("settled");
        return Promise.resolve();
      },
    });

    // A kill decided while the CREATE waited lands before START TRANSACTION, never on it.
    const after = events.slice(events.indexOf(create) + 1);
    expect(after.slice(0, 3)).toEqual(["at 1", "settled", "START TRANSACTION"]);
  });

  /** The statements a unit sends, with `ledger` where its ledger write starts. */
  async function sentAroundLedger(
    statements: string[],
    from?: number
  ): Promise<string[]> {
    const events: string[] = [];
    const { adapter } = mysqlAdapter({
      failStatement: statement => {
        events.push(statement);
        return undefined;
      },
    });
    await runMigrationStatements(
      adapter,
      statements,
      unit,
      () => {
        events.push("ledger");
        return Promise.resolve();
      },
      { tryMs: 1_000, ...(from === undefined ? {} : { from }) }
    );
    return events;
  }

  it("leaves the session in autocommit after the unit's last statement, so each ledger write commits on its own", async () => {
    // A down section's rollback row and the retirement of the applied row it names: committed
    // together, a stop between them would lose the rollback over statements that committed.
    const events = await sentAroundLedger(["DROP TABLE two", "DROP TABLE one"]);
    const tail = events.slice(events.indexOf("DROP TABLE one") + 1);
    expect(tail.slice(0, tail.indexOf("ledger"))).not.toContain(
      "START TRANSACTION"
    );
  });

  it("commits the try's transaction before the ledger write where a try resumes past every statement", async () => {
    // The try before ended in the ledger write, every statement committed: this one writes only
    // the ledger, in autocommit, as the try that ran the last statement would have.
    const events = await sentAroundLedger(
      ["DROP TABLE two", "DROP TABLE one"],
      2
    );
    expect(events).not.toContain("DROP TABLE one");
    expect(events.slice(0, events.indexOf("ledger"))).toContain("COMMIT");
  });

  it.each([
    ["after the unit's last statement", undefined],
    ["where a try resumes past every statement", 2],
  ] as const)(
    "turns autocommit on for the ledger write %s, and gives the session its default back",
    async (_case, from) => {
      // On a server whose sessions start with autocommit off, the first ledger write would open
      // a transaction of its own, and the writes would commit together after all.
      const events = await sentAroundLedger(
        ["DROP TABLE two", "DROP TABLE one"],
        from
      );
      const ledger = events.indexOf("ledger");
      expect(events.slice(0, ledger)).toContain("SET SESSION autocommit = 1");
      expect(events.slice(ledger)).toContain(
        "SET SESSION autocommit = DEFAULT"
      );
    }
  );

  it("leaves autocommit alone where the ledger write is in the unit's transaction", async () => {
    // A row change last: the transaction reopened after the DROP is still open, and the ledger
    // write commits with it.
    const events = await sentAroundLedger([
      "DROP TABLE two",
      "UPDATE counters SET n = n + 1",
    ]);
    expect(events).not.toContain("SET SESSION autocommit = 1");
  });
});

describe("runUnitInTries on MySQL in one transaction", () => {
  it("sends the open transaction again where the wait was in a schema statement's checkpoint, before it was sent", async () => {
    const add = "ALTER TABLE posts ADD COLUMN late int";
    const fill = "UPDATE posts SET late = 0";
    const require = "ALTER TABLE posts MODIFY COLUMN late int NOT NULL";
    const { adapter, sent } = mysqlAdapter({
      // The first try's checkpoint waits; every later read answers.
      failRead: readsBefore =>
        readsBefore === 0 ? mysqlLockWaitTimeout() : undefined,
    });

    await runUnitInTries(
      adapter,
      [add, fill, require],
      unit,
      async () => {},
      run
    );

    // The ADD committed before the fill; the fill was rolled back with the transaction the
    // checkpoint's wait ended, and is sent again before the NOT NULL is.
    const ofUnit = sent.filter(s => s !== "START TRANSACTION");
    expect(ofUnit).toEqual([add, fill, fill, require]);
  });

  it("keeps the row changes after a schema statement in one transaction, so a wait sends them again once", async () => {
    const create = "CREATE TABLE helper (id int)";
    const count = "UPDATE counters SET n = n + 1";
    const busy = "UPDATE busy SET x = 1";
    const { adapter, sent } = mysqlAdapter({
      failStatement: (statement, sentBefore) =>
        statement === busy && sentBefore === 0
          ? mysqlLockWaitTimeout()
          : undefined,
    });

    await runUnitInTries(
      adapter,
      [create, count, busy],
      unit,
      async () => {},
      run
    );

    // A transaction opens again after the CREATE's implicit commit, so the wait rolls the counter
    // back with it, and the next try, in a transaction of its own, sends it again from there.
    expect(sent).toEqual([
      create,
      "START TRANSACTION",
      count,
      busy,
      count,
      busy,
    ]);
  });
});
