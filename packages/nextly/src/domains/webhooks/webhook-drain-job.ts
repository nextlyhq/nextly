/**
 * Webhook delivery as a job type — the first consumer of the shared runner.
 *
 * This is what proves the extraction. The runner's lease, fencing, retry and
 * budget were lifted from this domain, so putting the drain back on top of them
 * is the test that they were lifted faithfully: a real, already-reviewed
 * workload rather than a fixture written to agree with the new code.
 *
 * ## Why a factory rather than a bare definition
 *
 * The drain needs the raw database adapter and the endpoint registry. A job
 * handler receives only its input and a context, deliberately — widening
 * `JobContext` to carry the Nextly instance would point the jobs domain at the
 * instance that owns it, and this repo already has a standing task for its
 * import cycles.
 *
 * A handler that needs CONTENT does not need this: the Direct API resolves
 * itself lazily (`direct-api/nextly.ts` calls `getNextly()` per method), so a
 * job can import and use it without anything being threaded through. Only a
 * consumer like this one, which wants the adapter beneath the API, takes deps
 * at registration.
 *
 * ## This does not replace the existing triggers yet
 *
 * The cron/manual route and the post-response fast path stay exactly as they
 * are. Removing them before the job runner has a trigger of its own would leave
 * webhook delivery with nothing to run it — the failure Payload's own docs warn
 * about, where scheduled work never fires because no processor exists. Running
 * both is safe precisely because of the lease: whichever gets there first
 * claims each delivery, and the other finds nothing to do.
 *
 * @module domains/webhooks/webhook-drain-job
 */

import { defineJob, type JobDefinition } from "../jobs/job-registry";

import {
  IN_PASS_DRAIN_BOUNDS,
  runWebhookDrain,
  type RunWebhookDrainOptions,
  type WebhookDrainDatabase,
  type WebhookDrainRegistry,
} from "./drain-runner";
import type { RunDrainResult } from "./run-drain";

/**
 * Fit a drain inside what is LEFT of the pass, not inside a fixed budget.
 *
 * `runJobs` checks its wall-clock budget before starting a handler and cannot
 * interrupt a running one, so a handler beginning late has less pass remaining
 * than any constant could know: an earlier job that overran leaves this one
 * starting with seconds rather than the full tick. Beginning a fixed-length
 * drain then means outliving the invocation and being killed before the row is
 * finalized — the sweep retries having done partial work.
 *
 * The deadline the runner supplies is the only value that knows the answer.
 * Reserved against it is one in-flight request: the budget bounds when the drain
 * stops STARTING deliveries, not when the last one returns.
 *
 * A caller's explicit `maxDurationMs` still wins — a trigger that owns its whole
 * invocation, rather than sharing a pass, is entitled to say so.
 */
function boundsWithin(
  deadline: Date,
  options?: RunWebhookDrainOptions
): Pick<RunWebhookDrainOptions, "maxDurationMs" | "requestTimeoutMs"> {
  if (options?.maxDurationMs !== undefined) return {};

  const remaining = Math.max(0, deadline.getTime() - Date.now());

  // The per-request timeout shrinks with the remaining time, and does not simply
  // sit at its default. With little of the pass left, a request allowed the full
  // default would overrun the invocation on its own — the very failure the
  // budget exists to prevent, arriving through the timeout instead. Half the
  // remainder leaves the other half to actually start deliveries in.
  const requestTimeoutMs = Math.min(
    options?.requestTimeoutMs ?? IN_PASS_DRAIN_BOUNDS.requestTimeoutMs,
    Math.floor(remaining / 2)
  );

  return {
    // Never negative. A pass already at or past its deadline yields zero, which
    // the engine reads as "start nothing" — correct, and different from omitting
    // the field, which would read as no limit at all.
    maxDurationMs: Math.max(0, remaining - requestTimeoutMs),
    requestTimeoutMs,
  };
}

/** The slug the drain is registered and enqueued under. */
export const WEBHOOK_DRAIN_JOB = "webhooks:drain";

/**
 * A drain pass, as a job.
 *
 * The pass is RETRYABLE, and an earlier version of this module was wrong about
 * why it should not be.
 *
 * The reasoning then was that re-running a sweep would re-attempt deliveries
 * that had already recorded an outcome and restart their backoff from the wrong
 * clock. It would not: `deliverDueDeliveries` selects only `pending`/`retrying`
 * rows whose `nextAttemptAt` has passed and whose lease is free
 * (`deliver.ts:706-719`), so a completed delivery is already excluded and a
 * deferred one stays deferred. Per-row retry state is exactly what makes the
 * sweep safe to repeat.
 *
 * What a single attempt DID cost: a transient failure — the database briefly
 * unreachable, the endpoint registry erroring — made the job row terminally
 * failed and left the remaining outbox work to whenever some other trigger
 * happened to fire.
 */
export function createWebhookDrainJob(
  adapter: WebhookDrainDatabase,
  registry: WebhookDrainRegistry,
  options?: RunWebhookDrainOptions,
  /**
   * What to do with the outcome of each pass.
   *
   * A drain completes as a job while individual deliveries fail — a receiver is
   * down, a URL now refuses, a payload is rejected. Those retry on their own
   * backoff and eventually stop, and without a report the only trace of an
   * endpoint that has stopped receiving anything is a returned object nobody
   * read. Optional here rather than required, unlike the releases drain: this
   * factory already exists and is already exported, so making it required would
   * break a caller to add a diagnostic. The registration supplies a real one.
   */
  onOutcome?: (result: RunDrainResult) => void | Promise<void>
): JobDefinition<unknown> {
  return defineJob({
    slug: WEBHOOK_DRAIN_JOB,
    // A sweep: an event reaches the outbox on a content write, but the DRAIN
    // that delivers it has no request of its own. It has to happen on an
    // interval — including on an installation that has gone quiet with
    // deliveries still owed — so nothing is ever in a position to enqueue it,
    // and a trigger keeps one queued instead.
    //
    // Without this the definition is registered and unrunnable: the queue stays
    // empty and looks exactly like a queue with nothing to do.
    sweep: true,
    handler: async (_input, context) => {
      const result = await runWebhookDrain(adapter, registry, {
        ...options,
        ...boundsWithin(context.deadline, options),
      });
      await onOutcome?.(result);
    },
  });
}
