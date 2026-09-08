/**
 * The one answer to "how long has this handler got".
 *
 * The cases worth stating are the ones where an injected runner clock and wall
 * time disagree, because that is the only condition under which a wrong
 * implementation is observably wrong — and it is reachable through the
 * documented `now` option on `runJobsPass`/`runJobs`.
 *
 * @module domains/jobs/__tests__/remaining-pass.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { remainingPassMs } from "../remaining-pass";

/** A context shaped the way `runJobs` builds one: both fields, one clock. */
function context(runnerNow: Date, msLeft: number) {
  return { now: runnerNow, deadline: new Date(runnerNow.getTime() + msLeft) };
}

describe("remainingPassMs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("measures between the runner's own two fields, not against wall time", () => {
    vi.useFakeTimers();
    // Wall time years AHEAD of the runner's clock. Anchoring to `Date.now()`
    // makes the span negative here, clamps it to zero, and the handler starts
    // nothing on every pass while reporting a clean empty run.
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));

    expect(
      remainingPassMs(context(new Date("2020-01-01T00:00:00.000Z"), 9_000))
    ).toBe(9_000);
  });

  it("does not inflate the span when wall time runs behind the runner's clock", () => {
    vi.useFakeTimers();
    // The opposite skew, and the dangerous one: a `Date.now()` anchor returns
    // far MORE than the pass has, so the handler keeps starting work after the
    // invocation should have ended and is killed part-way.
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));

    expect(
      remainingPassMs(context(new Date("2026-06-01T12:00:00.000Z"), 9_000))
    ).toBe(9_000);
  });

  it("yields zero rather than a negative span for a pass already past its deadline", () => {
    // Zero reads as "start nothing more". A negative value would be read as a
    // deadline in the past by some callers and as no limit at all by others.
    const now = new Date("2026-06-01T12:00:00.000Z");
    expect(
      remainingPassMs({ now, deadline: new Date(now.getTime() - 5_000) })
    ).toBe(0);
  });

  it("is unaffected by real time passing, because it reads two fixed instants", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
    const ctx = context(new Date("2026-06-01T12:00:00.000Z"), 9_000);

    const before = remainingPassMs(ctx);
    vi.setSystemTime(new Date("2026-06-01T12:00:07.000Z"));

    // The span is a property of the context, not of when it is asked. Callers
    // measure their own elapsed time; conflating the two is what the wall-clock
    // anchor did.
    expect(remainingPassMs(ctx)).toBe(before);
  });
});
