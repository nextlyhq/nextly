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

import { JOB_STATES } from "../../../schemas/jobs/types";

import {
  ATTENTION_STATES,
  jobDisplayStatus,
  jobNeedsAttention,
  storedStatesFor,
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

describe("the status facts table, checked against the function it describes", () => {
  /*
   * `STATUS_FACTS` claims which stored states can appear as each display
   * status, and `ATTENTION_STATES` is computed from it. A table asserted by
   * hand is a second implementation of `jobDisplayStatus`; these derive it from
   * the function instead, so the two cannot disagree.
   */
  const NOW = new Date("2026-09-02T12:00:00.000Z");
  const PAST = new Date("2026-09-02T11:00:00.000Z");
  const FUTURE = new Date("2026-09-02T13:00:00.000Z");

  /** Every row shape the derivation can distinguish, over every stored state. */
  const rows = JOB_STATES.flatMap(state =>
    [0, 1].flatMap(attemptCount =>
      [null, PAST, FUTURE].map(lockedUntil => ({
        state,
        attemptCount,
        lockedUntil,
      }))
    )
  );

  it("declares every stored state that can actually produce each status", () => {
    for (const row of rows) {
      const status = jobDisplayStatus(row, NOW);
      expect(
        storedStatesFor(status),
        `${row.state} attempts=${row.attemptCount} lease=${String(row.lockedUntil)} -> ${status}`
      ).toContain(row.state);
    }
    // The premise: the sweep covered every stored state and produced more than
    // one status, so "contains" is not trivially satisfied.
    expect(new Set(rows.map(r => r.state)).size).toBe(JOB_STATES.length);
    expect(
      new Set(rows.map(r => jobDisplayStatus(r, NOW))).size
    ).toBeGreaterThan(2);
  });

  it("selects exactly the states an attention-needing status can hold", () => {
    // Computed here from the PREDICATE, independently of how the constant is
    // built, so a constant that stopped tracking the predicate fails.
    const expected = new Set(
      rows
        .filter(row => jobNeedsAttention(jobDisplayStatus(row, NOW)))
        .map(row => row.state)
    );
    expect(new Set(ATTENTION_STATES)).toEqual(expected);
    // The premise: some status really does need attention, so this is not two
    // empty sets agreeing.
    expect(ATTENTION_STATES.length).toBeGreaterThan(0);
  });

  it("answers a status this build has never heard of, rather than throwing", () => {
    /*
     * A status arrives from the wire. During a rolling deploy a newer server
     * can send one this build does not know, and indexing the facts table on
     * that key throws — taking down the page whose whole job is to report that
     * something is wrong.
     *
     * It answers FALSE, which makes the predicate unsafe as the only filter: a
     * caller asking "did anything fail" narrows by ATTENTION_STATES in the
     * query, where the server's own vocabulary decides, and uses this to
     * describe what came back rather than to find it.
     */
    expect(() => jobNeedsAttention("quarantined")).not.toThrow();
    expect(jobNeedsAttention("quarantined")).toBe(false);
    // Prototype keys are the sharp edge of a plain object lookup.
    expect(jobNeedsAttention("toString")).toBe(false);
    expect(jobNeedsAttention("constructor")).toBe(false);
    // The premise: it still answers TRUE for a status it does know, so this is
    // not a predicate that has simply stopped working.
    expect(jobNeedsAttention("failed")).toBe(true);
  });

  it("does not select a state that only quiet statuses can hold", () => {
    // The control. `done` is reachable only as `succeeded`, which needs nobody,
    // so a filter that included it would be selecting healthy rows.
    expect(ATTENTION_STATES).not.toContain("done");
  });
});
