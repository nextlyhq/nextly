/**
 * The loop of tries for a busy table, on a clock the test moves: how many tries it makes, what it
 * says between them, and how it stops.
 */
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BUSY_TABLE_BOUNDS, type BusyTableBounds } from "../bounds";
import { withBusyTableTries, type TryResult } from "../tries";
import type { BusyTableStop, HolderReport } from "../types";

const HOLDER: HolderReport = { kind: "unnamed", reason: "unnamed holder" };

/** A try that waited out its whole bound on table `posts`. */
const ENDED: TryResult<never> = {
  kind: "ended",
  ended: { table: "posts", holder: HOLDER },
  undone: true,
  committed: [],
};

/** Thrown in place of the real report, carrying what the loop stopped with. */
class Stopped extends Error {
  constructor(readonly stop: BusyTableStop) {
    super("stopped");
  }
}

/**
 * The loop on a test clock: each try takes its whole bound unless `results` says it was done, and
 * each pause takes exactly what it asked.
 */
function harness(
  results: (tryNumber: number) => TryResult<string>,
  options: {
    bounds?: BusyTableBounds;
    assertHeld?: () => Promise<void>;
    leaseDeadline?: () => number | undefined;
  } = {}
) {
  const bounds = options.bounds ?? DEFAULT_BUSY_TABLE_BOUNDS;
  let clock = 0;
  const starts: number[] = [];
  const notices: string[] = [];
  const assertHeld = vi.fn(options.assertHeld ?? (() => Promise.resolve()));
  const run = withBusyTableTries(
    {
      bounds,
      change: "0007_add_keys.sql",
      appliedBefore: ["0006_earlier.sql"],
      notify: line => notices.push(line),
      notice: ({ tryNumber, plannedTries }) =>
        `try ${String(tryNumber)} of ${String(plannedTries)}`,
      assertHeld,
      stopped: stop => new Stopped(stop),
      leaseDeadline: options.leaseDeadline,
      now: () => clock,
      sleep: ms => {
        clock += ms;
        return Promise.resolve();
      },
    },
    tryNumber => {
      starts.push(clock);
      const result = results(tryNumber);
      if (result.kind === "ended") clock += bounds.tryMs;
      return Promise.resolve(result);
    }
  );
  return { run, starts, notices, assertHeld };
}

describe("withBusyTableTries", () => {
  it("returns at once where the first try gets its locks, saying nothing", async () => {
    const { run, notices, assertHeld } = harness(() => ({
      kind: "done",
      value: "applied",
    }));
    await expect(run).resolves.toBe("applied");
    expect(notices).toEqual([]);
    expect(assertHeld).not.toHaveBeenCalled();
  });

  it("applies on the next try once the holder ends during the third pause", async () => {
    const { run, starts, notices, assertHeld } = harness(tryNumber =>
      tryNumber <= 3 ? ENDED : { kind: "done", value: "applied" }
    );
    await expect(run).resolves.toBe("applied");
    expect(starts).toEqual([0, 6_000, 13_000, 22_000]);
    expect(notices).toEqual(["try 2 of 7", "try 3 of 7", "try 4 of 7"]);
    // Before every try after the first, the run shows it still holds the schema lock.
    expect(assertHeld).toHaveBeenCalledTimes(3);
  });

  it("stops after the scheduled tries, within the total bound, with nothing changed", async () => {
    const { run, starts } = harness(() => ENDED);
    const stopped = (await run.catch((error: unknown) => error)) as Stopped;
    expect(starts).toEqual([0, 6_000, 13_000, 22_000, 35_000, 55_000, 75_000]);
    expect(stopped.stop).toMatchObject({
      change: "0007_add_keys.sql",
      tries: 7,
      elapsedMs: 80_000,
      appliedBefore: ["0006_earlier.sql"],
      outcome: { kind: "nothing-changed" },
      cause: "table-busy",
      endedAtLease: false,
    });
    expect(stopped.stop.elapsedMs).toBeLessThanOrEqual(90_000);
  });

  it("stops after one try where the try ran a statement that may not run again", async () => {
    const { run, starts, notices } = harness(() => ({
      ...ENDED,
      lasting: {
        statementNumber: 2,
        judgement: { kind: "no-retry", reason: "setval" },
      },
    }));
    const stopped = (await run.catch((error: unknown) => error)) as Stopped;
    expect(starts).toEqual([0]);
    expect(notices).toEqual([]);
    expect(stopped.stop.outcome).toEqual({
      kind: "no-retry",
      statementNumber: 2,
      reason: "setval",
      restUndone: true,
    });
  });

  it("reports the statements earlier tries made durable as a change stopped part-way", async () => {
    const { run } = harness(tryNumber => ({
      ...ENDED,
      undone: false,
      committed: tryNumber === 1 ? [1] : [],
    }));
    const stopped = (await run.catch((error: unknown) => error)) as Stopped;
    expect(stopped.stop.outcome).toEqual({
      kind: "part-way",
      committed: [1],
    });
  });

  it("sends no further try once the run lost the schema lock during a pause", async () => {
    const lost = new Error("lost the schema lock");
    let tries = 0;
    const { run } = harness(
      () => {
        tries++;
        return ENDED;
      },
      { assertHeld: () => Promise.reject(lost) }
    );
    await expect(run).rejects.toBe(lost);
    expect(tries).toBe(1);
  });

  it("stops at the schema lock's lease where it cannot be renewed, before the total", async () => {
    const { run, starts } = harness(() => ENDED, {
      leaseDeadline: () => 70_000,
    });
    const stopped = (await run.catch((error: unknown) => error)) as Stopped;
    // The try at 55 s would end at 60 s; the one at 75 s would end past the lease.
    expect(starts).toEqual([0, 6_000, 13_000, 22_000, 35_000, 55_000]);
    expect(stopped.stop).toMatchObject({ tries: 6, endedAtLease: true });
  });

  it("follows overridden bounds: a try of 1 second and a total of 10", async () => {
    const { run, starts } = harness(() => ENDED, {
      bounds: { tryMs: 1_000, totalMs: 10_000 },
    });
    const stopped = (await run.catch((error: unknown) => error)) as Stopped;
    expect(starts).toEqual([0, 2_000, 5_000]);
    expect(stopped.stop.elapsedMs).toBeLessThanOrEqual(15_000);
  });
});
