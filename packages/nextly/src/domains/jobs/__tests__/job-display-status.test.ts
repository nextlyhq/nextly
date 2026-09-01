/**
 * The distinction the stored state cannot make.
 *
 * `finalize` writes `pending` for BOTH a job that has never run and one whose
 * attempt failed and is scheduled to try again, so any test that only varied
 * `state` would pass against an implementation that ignored `attemptCount`
 * entirely — and that implementation is the defect. Every case below therefore
 * pins a pair that shares a state and differs in the count, or the reverse.
 */
import { describe, expect, it } from "vitest";

import {
  jobDisplayStatus,
  jobNeedsAttention,
  type JobStatusInput,
} from "../job-display-status";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const LIVE = new Date(NOW.getTime() + 30_000);
const EXPIRED = new Date(NOW.getTime() - 30_000);

const row = (over: Partial<JobStatusInput> = {}): JobStatusInput => ({
  state: "pending",
  attemptCount: 0,
  lockedUntil: null,
  ...over,
});

const status = (over: Partial<JobStatusInput> = {}) =>
  jobDisplayStatus(row(over), NOW);

describe("what a job row means to a person", () => {
  it("separates a job that has never run from one that is retrying", () => {
    // Same state. Only the count differs, which is the whole mechanism.
    expect(status({ state: "pending", attemptCount: 0 })).toBe("waiting");
    expect(status({ state: "pending", attemptCount: 2 })).toBe("retrying");
  });

  it("reports a spent job as failed, not as retrying", () => {
    // A terminal failure also carries attempts. Reading the count first would
    // call this "retrying" and bury a dead job among self-healing noise.
    expect(status({ state: "failed", attemptCount: 5 })).toBe("failed");
  });

  it("reports the remaining stored states", () => {
    expect(status({ state: "running", attemptCount: 1 })).toBe("running");
    expect(status({ state: "done", attemptCount: 1 })).toBe("succeeded");
  });

  /*
   * The case the state column CANNOT express. `claim` takes the lease without
   * touching state and `markAttempt` raises the count before the handler runs,
   * so a healthy first attempt in flight is `pending` with a count of 1 — which
   * by count alone reads as "retrying" and tells an operator a working job has
   * already failed once.
   */
  it("reports work in flight as running, not as retrying", () => {
    expect(
      status({ state: "pending", attemptCount: 1, lockedUntil: LIVE })
    ).toBe("running");
  });

  /*
   * An EXPIRED lease is a runner that died, not a job executing. The row is
   * waiting to be reclaimed, so the comparison must be against the clock rather
   * than against the field merely being set.
   */
  it("does not call an expired lease running", () => {
    expect(
      status({ state: "pending", attemptCount: 1, lockedUntil: EXPIRED })
    ).toBe("retrying");
    expect(
      status({ state: "pending", attemptCount: 0, lockedUntil: EXPIRED })
    ).toBe("waiting");
  });

  /*
   * The alarm is exactly one status. Asserted across the whole vocabulary
   * rather than on `failed` alone, so adding a status that should raise one —
   * or should not — has to be a decision made here.
   */
  it("raises attention for a terminal failure and nothing else", () => {
    expect(jobNeedsAttention("failed")).toBe(true);
    for (const quiet of [
      "waiting",
      "retrying",
      "running",
      "succeeded",
    ] as const) {
      expect(jobNeedsAttention(quiet)).toBe(false);
    }
  });
});
