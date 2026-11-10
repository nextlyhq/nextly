/**
 * The `events:dispatch` job: one dispatch pass of the durable plugin events
 * per jobs run, within the run's own time.
 *
 * @module domains/plugin-events/dispatch-job
 * @experimental
 */
import { defineJob, type JobDefinition } from "../jobs/job-registry";

import { dispatchDurableEvents, type DispatchAdapter } from "./dispatch";
import type { DurableSubscribers } from "./subscribers";

export const DURABLE_EVENTS_DISPATCH_JOB = "events:dispatch";

/** The job, reading the adapter and the subscribers each run. */
export function createDurableEventsDispatchJob(deps: {
  adapter: () => DispatchAdapter;
  subscribers: () => DurableSubscribers;
}): JobDefinition {
  return defineJob({
    slug: DURABLE_EVENTS_DISPATCH_JOB,
    // A sweep: an event is recorded by a write that has finished long before
    // its deliveries are owed, and a failed delivery comes due again at an
    // instant with no request attached. Nothing is in a position to enqueue
    // this, so a trigger keeps one queued, as the webhook drain's is.
    sweep: true,
    handler: async (_input, context) => {
      await dispatchDurableEvents({
        adapter: deps.adapter(),
        subscribers: deps.subscribers(),
        // Within the jobs run's own time: it cannot interrupt a handler once
        // started, so the pass stops starting work at the run's deadline.
        deadline: context.deadline.getTime(),
      });
    },
  });
}
