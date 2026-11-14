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
