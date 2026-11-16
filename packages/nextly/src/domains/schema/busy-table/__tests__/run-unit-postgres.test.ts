/**
 * What a PostgreSQL unit's tries judge after a wait in a statement's checkpoint, read against a
 * stand-in adapter: the statement whose checkpoint waited was never sent, so sending it next is
 * no repeat, and a DDL event trigger does not stop the run on it.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it } from "vitest";

import type { BusyTableBounds } from "../bounds";
import { runUnitInTries } from "../run-unit";

const BOUNDS: BusyTableBounds = { tryMs: 100, totalMs: 1_500 };

/** PostgreSQL's `lock_timeout` running out. */
function pgLockNotAvailable(): Error {
  return Object.assign(new Error("canceling statement due to lock timeout"), {
    code: "55P03",
  });
}

/**
 * A PostgreSQL stand-in with one enabled DDL event trigger no extension owns; its transactions
 * record every statement of the unit sent (`sent`), and a read of the checkpoint waits once.
 */
function pgAdapter() {
  const sent: string[] = [];
  let catalogReads = 0;
  const adapter = {
    getCapabilities: () => ({ dialect: "postgresql" as const }),
    transactionOpenInFlow: () => false,
    queryStatement: (query: unknown) =>
      Promise.resolve(
        JSON.stringify(query).includes("pg_event_trigger") ? [{ found: 1 }] : []
      ),
    executeQuery: () => Promise.resolve([]),
    getDrizzle: () => ({}),
    transaction: <T>(work: (ctx: unknown) => Promise<T>): Promise<T> =>
      work({
        execute: (statement: string) => {
          if (!/^(SET|RESET)\b/.test(statement)) sent.push(statement);
          return Promise.resolve([]);
        },
        queryStatement: () => Promise.resolve([{ session_id: 4242 }]),
        // The settings put back before the ledger write.
        runStatement: () => Promise.resolve(),
        getDrizzle: () => ({
          // The checkpoint's reads: the column, nullable, on its table; its first other read waits,
          // and the later ones find nothing in the way.
          execute: (query: unknown) => {
            const text = JSON.stringify(query);
            if (text.includes("column_name")) {
              return Promise.resolve({
                rows: [
                  {
                    table_name: "posts",
                    column_name: "late",
                    udt_name: "int4",
                    is_nullable: "YES",
                  },
                ],
              });
            }
            if (text.includes("pg_class")) {
              return Promise.resolve({ rows: [{ name: "posts" }] });
            }
            catalogReads += 1;
            return catalogReads === 1
              ? Promise.reject(pgLockNotAvailable())
              : Promise.resolve({ rows: [{ count: 0, n: 0 }] });
          },
        }),
      }),
  };
  return { adapter: adapter as unknown as DrizzleAdapter, sent };
}

describe("runUnitInTries on PostgreSQL after a wait in a checkpoint", () => {
  it("sends the unit again where the statement whose checkpoint waited is one an event trigger fires on", async () => {
    const fill = "UPDATE posts SET late = 0";
    const require = "ALTER TABLE posts ALTER COLUMN late SET NOT NULL";
    const { adapter, sent } = pgAdapter();

    await runUnitInTries(
      adapter,
      [fill, require],
      { source: "0001_test.sql", transaction: true },
      async () => {},
      { bounds: BOUNDS, notify: () => {}, appliedBefore: () => [] }
    );

    // The ALTER never reached the database in the first try, so its event trigger never fired.
    expect(sent).toEqual([fill, fill, require]);
  });
});
