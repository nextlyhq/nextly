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
 *
 * What they establish is the FIRST-START case: a drain beginning at the top of a
 * pass finishes inside it. A handler that starts late is bounded by the pass's
 * remaining time rather than by any constant, and that value has to reach the
 * handler from the runner before it can be enforced.
 */

import { describe, expect, it, vi } from "vitest";

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

  it("fits the whole pass when it is the first handler to start", () => {
    // What a STATIC bound can establish, and the limit of it.
    //
    // The budget caps when the drain stops STARTING work, not when its last
    // request returns, so a hung receiver adds up to one request timeout on top.
    // Both together fit the pass — provided this handler begins at the start of
    // it.
    //
    // It does NOT bound a late start. `runJobs` checks its budget before each
    // CLAIM and cannot interrupt a running handler, so an earlier job that
    // overran leaves this one starting with less pass remaining than it assumes,
    // and no constant chosen here can know that. Bounding the late start needs
    // the pass's own remaining time, which the runner has and the handler is not
    // yet given; the deadline on `JobContext` is where it will come from.
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

  it("derives its budget from what is LEFT of the pass, not a constant", async () => {
    // The late-start case a static bound cannot cover. `runJobs` checks its
    // budget before starting a handler and cannot interrupt one, so a job that
    // begins with three seconds of pass remaining must drain within three
    // seconds — whatever any constant says.
    const runWebhookDrain = vi.fn(async () => ({ rounds: 0 }));
    vi.doMock("../drain-runner", async importOriginal => {
      const actual = await importOriginal<typeof import("../drain-runner")>();
      return { ...actual, runWebhookDrain };
    });
    vi.resetModules();
    const { createWebhookDrainJob: create } = await import(
      "../webhook-drain-job"
    );

    const REMAINING_MS = 3_000;
    const job = create({} as never, {} as never);
    await job.handler(null, {
      user: null,
      now: new Date(),
      content: {} as never,
      deadline: new Date(Date.now() + REMAINING_MS),
    });

    const [, , options] = runWebhookDrain.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { maxDurationMs: number; requestTimeoutMs: number },
    ];
    // Everything the drain may spend — the budget it starts work in, plus the
    // one request that can still be in flight when the budget expires — fits
    // what is left of the pass. That is the property; the individual numbers are
    // whatever the arithmetic makes them.
    expect(
      options.maxDurationMs + options.requestTimeoutMs
    ).toBeLessThanOrEqual(REMAINING_MS);
    expect(options.maxDurationMs).toBeGreaterThan(0);
    // And the request timeout shrank rather than staying at its default, which
    // alone would have exceeded what remained.
    expect(options.requestTimeoutMs).toBeLessThan(
      IN_PASS_DRAIN_BOUNDS.requestTimeoutMs
    );
    vi.doUnmock("../drain-runner");
    vi.resetModules();
  });

  it("is registered as a sweep, or no trigger ever queues it", () => {
    const job = createWebhookDrainJob({} as never, {} as never);

    expect(job.sweep).toBe(true);
  });
});
