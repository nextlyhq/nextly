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

const row = (over: Partial<JobStatusInput> = {}): JobStatusInput => ({
  state: "pending",
  attemptCount: 0,
  ...over,
});

describe("what a job row means to a person", () => {
  it("separates a job that has never run from one that is retrying", () => {
    // Same state. Only the count differs, which is the whole mechanism.
    expect(jobDisplayStatus(row({ state: "pending", attemptCount: 0 }))).toBe(
      "waiting"
    );
    expect(jobDisplayStatus(row({ state: "pending", attemptCount: 2 }))).toBe(
      "retrying"
    );
  });

  it("reports a spent job as failed, not as retrying", () => {
    // A terminal failure also carries attempts. Reading the count first would
    // call this "retrying" and bury a dead job among self-healing noise.
    expect(jobDisplayStatus(row({ state: "failed", attemptCount: 5 }))).toBe(
      "failed"
    );
  });

  it("reports the remaining stored states", () => {
    expect(jobDisplayStatus(row({ state: "running", attemptCount: 1 }))).toBe(
      "running"
    );
    expect(jobDisplayStatus(row({ state: "done", attemptCount: 1 }))).toBe(
      "succeeded"
    );
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
