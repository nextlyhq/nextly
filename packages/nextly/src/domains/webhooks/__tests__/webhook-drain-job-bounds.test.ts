/**
 * The drain job's budget has to fit inside the pass that runs it.
 *
 * `runJobs` checks its wall-clock budget before STARTING a handler and cannot
 * interrupt a running one. So a handler that begins with a wider budget than the
 * pass can outlive the whole invocation: the platform kills the process before
 * the job row is finalized, and the sweep is retried having done partial work.
 *
 * These compare the two bound sets against each other rather than against copied
 * numbers, so they keep meaning something after either is retuned.
 */

import { describe, expect, it } from "vitest";

import { IN_PASS_DRAIN_BOUNDS, SCHEDULED_DRAIN_BOUNDS } from "../drain-runner";
import { createWebhookDrainJob } from "../webhook-drain-job";

/** The budget `api/jobs-run-route.ts` gives one pass. */
const JOBS_RUN_MAX_DURATION_MS = 20_000;

describe("the drain job's bounds", () => {
  it("finishes inside the jobs pass that starts it", () => {
    // The whole point. A drain that starts at the last moment the pass allows
    // must still return before the invocation is killed.
    expect(IN_PASS_DRAIN_BOUNDS.maxDurationMs).toBeLessThan(
      JOBS_RUN_MAX_DURATION_MS
    );
  });

  it("leaves room for an in-flight request after its own budget expires", () => {
    // The budget bounds when the drain stops STARTING work, not when its last
    // request returns. A hung receiver can therefore overrun it by up to one
    // request timeout, and that overrun has to fit in the pass too.
    expect(
      IN_PASS_DRAIN_BOUNDS.maxDurationMs + IN_PASS_DRAIN_BOUNDS.requestTimeoutMs
    ).toBeLessThan(JOBS_RUN_MAX_DURATION_MS);
  });

  it("is tighter than the dedicated route's, which owns its whole tick", () => {
    // The route is the only thing running in its invocation and can spend the
    // lot; the job is a guest inside someone else's budget. Same numbers for
    // both would mean one of the two is wrong.
    expect(IN_PASS_DRAIN_BOUNDS.maxDurationMs).toBeLessThan(
      SCHEDULED_DRAIN_BOUNDS.maxDurationMs
    );
  });

  it("is registered as a sweep, or no trigger ever queues it", () => {
    const job = createWebhookDrainJob({} as never, {} as never);

    expect(job.sweep).toBe(true);
  });
});
