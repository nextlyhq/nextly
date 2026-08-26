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
  runWebhookDrain,
  type RunWebhookDrainOptions,
  type WebhookDrainDatabase,
  type WebhookDrainRegistry,
} from "./drain-runner";

/** The slug the drain is registered and enqueued under. */
export const WEBHOOK_DRAIN_JOB = "webhooks:drain";

/**
 * A drain pass, as a job.
 *
 * `maxAttempts: 1`. A drain is not a unit of work that either succeeds or
 * fails — it is a sweep over an outbox whose OWN rows carry the retry state.
 * Retrying the sweep would re-attempt deliveries that already recorded their
 * outcome and re-run their backoff from the wrong clock, so the retry belongs
 * to the deliveries and not to the pass over them.
 */
export function createWebhookDrainJob(
  adapter: WebhookDrainDatabase,
  registry: WebhookDrainRegistry,
  options?: RunWebhookDrainOptions
): JobDefinition<unknown> {
  return defineJob({
    slug: WEBHOOK_DRAIN_JOB,
    retry: { maxAttempts: 1 },
    handler: async () => {
      await runWebhookDrain(adapter, registry, options);
    },
  });
}
