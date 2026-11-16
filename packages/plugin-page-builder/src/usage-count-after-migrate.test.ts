/**
 * The page builder's count after a migrate or an install: sweeps of the
 * usage backfill until the index is whole, within its time, stopping quietly
 * where another runner holds the sweep, and stopping where the backfill has
 * nothing left to do while the index is still not whole.
 *
 * @module usage-count-after-migrate.test
 */
import { describe, expect, it, vi } from "vitest";

import {
  countAfterMigrate,
  countThePages,
  MIGRATE_COUNT_MS,
} from "./usage-count-after-migrate";
import type { UsageIndexHealth } from "./usage-index-health";

/** Every scope walked, nothing out of reach: whole. */
const WHOLE: UsageIndexHealth = {
  coversExistingDocuments: true,
  anyUndetermined: false,
  dirty: false,
  backfillPending: false,
};
/** Scopes still to walk. */
const COUNTING: UsageIndexHealth = {
  ...WHOLE,
  coversExistingDocuments: false,
  backfillPending: true,
};
/** Every scope walked, and a page past its walk bound: never whole. */
const UNDETERMINED: UsageIndexHealth = {
  ...WHOLE,
  anyUndetermined: true,
};
/** Every scope walked, and content the index cannot reach: never whole. */
const UNREACHABLE: UsageIndexHealth = {
  ...WHOLE,
  coversExistingDocuments: false,
};

/** Health read in turn from `states`, the last repeated. */
function healthOf(...states: UsageIndexHealth[]) {
  let read = 0;
  return async () => states[Math.min(read++, states.length - 1)]!;
}

describe("counting the pages after a migrate", () => {
  it("leaves the pages left uncounted counted, sweep after sweep", async () => {
    const sweep = vi.fn(async () => ({ ran: true }));
    expect(
      await countAfterMigrate({
        sweep,
        health: healthOf(COUNTING, COUNTING, COUNTING, WHOLE),
      })
    ).toEqual({ kind: "whole" });
    expect(sweep).toHaveBeenCalledTimes(3);
    // Each sweep within the runner's cap and the time left.
    for (const [budget] of sweep.mock.calls as unknown as [number][]) {
      expect(budget).toBeLessThanOrEqual(20_000);
    }
  });

  it("runs nothing where the pages are already counted", async () => {
    const sweep = vi.fn(async () => ({ ran: true }));
    expect(await countAfterMigrate({ sweep, health: healthOf(WHOLE) })).toEqual(
      { kind: "whole" }
    );
    expect(sweep).not.toHaveBeenCalled();
  });

  it.each([
    ["a page too large to read whole", UNDETERMINED, "undetermined"],
    ["content the index cannot reach", UNREACHABLE, "unreachable"],
  ] as const)(
    "stops after one sweep where %s keeps the index from whole, saying why",
    async (_case, after, gap) => {
      const sweep = vi.fn(async () => ({ ran: true }));
      expect(
        await countAfterMigrate({ sweep, health: healthOf(COUNTING, after) })
      ).toEqual({ kind: "incomplete", gap });
      // Not a sweep more: none would change it, and each adds a job row.
      expect(sweep).toHaveBeenCalledTimes(1);
    }
  );

  it("runs no sweep where no work is left from the start", async () => {
    const sweep = vi.fn(async () => ({ ran: true }));
    expect(
      await countAfterMigrate({ sweep, health: healthOf(UNREACHABLE) })
    ).toEqual({ kind: "incomplete", gap: "unreachable" });
    expect(sweep).not.toHaveBeenCalled();
  });

  it("stops quietly where another run holds the count, as a second migrate at once finds", async () => {
    const sweep = vi.fn(async () => ({ ran: false }));
    expect(
      await countAfterMigrate({ sweep, health: healthOf(COUNTING) })
    ).toEqual({ kind: "held-elsewhere" });
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it("stops when its time is spent, leaving the rest to the next run", async () => {
    let clock = 0;
    const sweep = vi.fn(async (budget: number) => {
      clock += budget;
      return { ran: true };
    });
    expect(
      await countAfterMigrate({
        sweep,
        health: healthOf(COUNTING),
        now: () => clock,
      })
    ).toEqual({ kind: "unfinished" });
    expect(clock).toBe(MIGRATE_COUNT_MS);
  });
});

describe("the count a migrate and an install run", () => {
  it("is the bounded count, said as it ended", async () => {
    const said: string[] = [];
    const sweep = vi.fn(async () => ({ ran: true }));
    await countThePages({
      sweep,
      health: healthOf(COUNTING, UNDETERMINED),
      log: line => said.push(line),
    });
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(said).toEqual([
      "Coverage remains incomplete: some pages are too large to read in full, so what they use is not counted.",
    ]);
  });
});
