/**
 * When what a dashboard load's layout read answered ahead may be taken by the
 * load's batch: from the moment the layout read hands the load over, for five
 * seconds, and never before, however long the read took to get there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handOverReadAhead, readAheadState } from "../read-ahead-handover";

const START = new Date("2026-10-30T12:00:00Z").getTime();

/** The clock at `ms` after the start of the case. */
function at(ms: number): void {
  vi.setSystemTime(START + ms);
}

beforeEach(() => {
  // Only the clock: the module reads `Date.now()` and sets no timer.
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
});

afterEach(() => {
  vi.useRealTimers();
});

// The registry is held for the process, so each case names loads of its own.
describe("a dashboard load's read-ahead", () => {
  it("is pending until its layout read hands the load over, however long that takes", () => {
    expect(readAheadState("load-judging")).toBe("pending");
    // A minute on, the read still judging a slow card: not open, and not closed either.
    at(60_000);
    expect(readAheadState("load-judging")).toBe("pending");
  });

  it("is open for five seconds from the moment the load is handed over, then closed", () => {
    // Handed over a minute after the read began, as after a slow card.
    at(60_000);
    handOverReadAhead("load-slow");
    expect(readAheadState("load-slow")).toBe("open");
    at(60_000 + 4_999);
    expect(readAheadState("load-slow")).toBe("open");
    at(60_000 + 5_000);
    expect(readAheadState("load-slow")).toBe("closed");
  });

  it("opens only the load that was handed over", () => {
    handOverReadAhead("load-handed");
    expect(readAheadState("load-handed")).toBe("open");
    expect(readAheadState("load-other")).toBe("pending");
  });
});
