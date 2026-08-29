/**
 * Draining the webhook outbox as a registered job type.
 *
 * The webhook drain is the workload the jobs domain was extracted FROM, so
 * putting it back on the shared runner is the proof that the extraction kept
 * everything the original had. Nothing about how a drain works changes here: the
 * same `runWebhookDrain`, the same bounds, the same retention deps. What changes
 * is who can start one.
 *
 * ## Why this does not replace `/api/webhooks/drain`
 *
 * That route is published and deployments already schedule it. It keeps working
 * unchanged. What this adds is that an installation scheduling `/api/jobs/run`
 * gets its webhooks drained too, so a new deployment needs ONE cron entry rather
 * than one per subsystem — and every subsystem that later needs a tick gets it
 * without asking operators to add another.
 *
 * An installation that schedules both drains twice. That is wasteful and safe:
 * delivery is claimed under a lease, so two concurrent drains cannot deliver the
 * same event twice; the second simply finds nothing to claim.
 *
 * @module domains/webhooks/webhooks-drain-job
 */

import { defineJob } from "../jobs/job-registry";
import type { JobDefinition } from "../jobs/job-registry";

import {
  runWebhookDrain,
  SCHEDULED_DRAIN_BOUNDS,
  type RunWebhookDrainOptions,
  type WebhookDrainDatabase,
  type WebhookDrainRegistry,
} from "./drain-runner";
import type { RunDrainResult } from "./run-drain";

/** The registered slug. Stated once so the runner and the trigger agree. */
export const WEBHOOKS_DRAIN_JOB = "webhooks:drain";

export function createWebhooksDrainJob(deps: {
  db: WebhookDrainDatabase;
  /** The shared endpoint registry, so a new subscriber is never missed. */
  registry: WebhookDrainRegistry;
  /** Retention housekeeping, when the installation has a policy to run. */
  retention: RunWebhookDrainOptions["retention"];
  /**
   * What to do with the outcome of each pass. REQUIRED.
   *
   * A drain can fail individual deliveries while the job row completes
   * successfully — a receiver is down, a URL now refuses, a payload is rejected.
   * Those deliveries retry on their own backoff and eventually stop, and with an
   * optional callback the only trace of an endpoint that has stopped receiving
   * anything is a returned object nobody read.
   *
   * The domain does not pick a logger: the wiring site knows where a report
   * belongs. Required so that decision is MADE rather than defaulted to silence.
   */
  onOutcome: (result: RunDrainResult) => void | Promise<void>;
}): JobDefinition<unknown> {
  return defineJob({
    slug: WEBHOOKS_DRAIN_JOB,
    // A sweep. An event reaches the outbox on a content write, but the DRAIN
    // that delivers it has no request of its own — it must happen on an
    // interval, including on an installation that has gone quiet with
    // deliveries still owed. Nothing is ever in a position to enqueue it.
    sweep: true,
    handler: async () => {
      const result = await runWebhookDrain(deps.db, deps.registry, {
        ...SCHEDULED_DRAIN_BOUNDS,
        retention: deps.retention,
      });
      await deps.onOutcome(result);
    },
  });
}
