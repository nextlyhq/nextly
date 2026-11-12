/**
 * `migrate:create`'s counts take at most their budget, all together: a count
 * past it is not waited for, the ones after it do not start, and those are
 * listed without a count. The database is a stand-in whose counts take as
 * long as each case says, in the order they are asked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Deletion } from "../../../domains/schema/migrate/data-loss-consent";

const db = vi.hoisted(() => ({
  delays: [] as number[],
  asked: 0,
  disconnected: false,
}));

vi.mock("../../utils/adapter", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/adapter")>()),
  openDryRunAdapter: async () => ({
    dialect: "postgresql",
    disconnect: async () => {
      db.disconnected = true;
    },
    getDrizzle: () => ({
      execute: () => {
        const delay = db.delays[db.asked] ?? 0;
        db.asked += 1;
        return new Promise(settle =>
          setTimeout(() => settle({ rows: [{ count: "7" }] }), delay)
        );
      },
    }),
  }),
}));

import { countWhereReadable } from "../migrate-create";

const said: string[] = [];
const logger = { info: (m: string) => said.push(m) } as never;
const table = (name: string): Deletion => ({ kind: "table", table: name });

beforeEach(() => {
  db.delays = [];
  db.asked = 0;
  db.disconnected = false;
  said.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("countWhereReadable's budget", () => {
  it("counts every deletion inside the budget, and closes the database", async () => {
    db.delays = [5, 5];
    const counted = await countWhereReadable(
      [table("a"), table("b")],
      "postgresql",
      logger,
      1000
    );
    expect(counted).toEqual([
      { ...table("a"), count: 7 },
      { ...table("b"), count: 7 },
    ]);
    expect(said).toEqual([]);
    expect(db.disconnected).toBe(true);
  });

  it("stops at the budget: the count past it is not waited for, and none after it starts", async () => {
    db.delays = [5, 2000, 5];
    const started = Date.now();
    const counted = await countWhereReadable(
      [table("a"), table("b"), table("c")],
      "postgresql",
      logger,
      200
    );
    expect(Date.now() - started).toBeLessThan(1500);
    expect(counted).toEqual([
      { ...table("a"), count: 7 },
      table("b"),
      table("c"),
    ]);
    expect(db.asked).toBe(2);
    expect(said).toEqual([
      "Counts stopped at their time limit; the rest are listed without one.",
    ]);
    // Closed only once the count still running settles.
    expect(db.disconnected).toBe(false);
  });
});
