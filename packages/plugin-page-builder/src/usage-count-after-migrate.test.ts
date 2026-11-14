/**
 * The page builder's count after a migrate: sweeps of the usage backfill
 * until the index is whole, within its time, stopping quietly where another
 * runner holds the sweep.
 *
 * @module usage-count-after-migrate.test
 */
import { describe, expect, it, vi } from "vitest";

import {
  countAfterMigrate,
  MIGRATE_COUNT_MS,
} from "./usage-count-after-migrate";

describe("counting the pages after a migrate", () => {
  it("leaves the pages left uncounted counted, sweep after sweep", async () => {
    // Three sweeps' worth of pages: the index is whole after the third.
    let sweeps = 0;
    const sweep = vi.fn(async () => {
      sweeps += 1;
      return { ran: true };
    });
    expect(
      await countAfterMigrate({ sweep, whole: async () => sweeps >= 3 })
    ).toBe("whole");
    expect(sweep).toHaveBeenCalledTimes(3);
    // Each sweep within the runner's cap and the time left.
    for (const [budget] of sweep.mock.calls as unknown as [number][]) {
      expect(budget).toBeLessThanOrEqual(20_000);
    }
  });

  it("runs nothing where the pages are already counted", async () => {
    const sweep = vi.fn(async () => ({ ran: true }));
    expect(await countAfterMigrate({ sweep, whole: async () => true })).toBe(
      "whole"
    );
    expect(sweep).not.toHaveBeenCalled();
  });

  it("stops quietly where another run holds the count, as a second migrate at once finds", async () => {
    const sweep = vi.fn(async () => ({ ran: false }));
    expect(await countAfterMigrate({ sweep, whole: async () => false })).toBe(
      "held-elsewhere"
    );
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
        whole: async () => false,
        now: () => clock,
      })
    ).toBe("unfinished");
    expect(clock).toBe(MIGRATE_COUNT_MS);
  });
});
