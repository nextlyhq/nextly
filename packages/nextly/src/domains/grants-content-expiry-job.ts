/**
 * The job that expires every collection's and Single's cached reads after a
 * change to what a role grants, for a process that could not.
 *
 * `expireContentAfterGrantsChange` queues one before it tries the expiry and
 * withdraws it once the expiry lands, so a queued one is an expiry still owed:
 * the process that owed it failed and is still trying, or is gone (a restart,
 * a frozen serverless function). The jobs queue is the durable mechanism every
 * deployment already triggers (`/api/jobs/run`), so the next jobs run performs
 * it whatever became of that process. Idempotent: an expiry made twice only
 * refreshes the pages once more.
 *
 * @module domains/grants-content-expiry-job
 */
import { languageChangeContentCache } from "../di/registrations/language-change-content-cache";

import {
  GRANTS_CONTENT_EXPIRY_JOB,
  flushEveryContentScope,
} from "./flush-content-change";
import { defineJob, type JobDefinition } from "./jobs/job-registry";

/**
 * Attempts before the job is given up on: with the queue's backoff, from one
 * second doubling to an hour, about half a day of failures.
 */
const MAX_ATTEMPTS = 24;

export function createGrantsContentExpiryJob(): JobDefinition<null> {
  return defineJob<null>({
    slug: GRANTS_CONTENT_EXPIRY_JOB,
    retry: { maxAttempts: MAX_ATTEMPTS },
    // A failed read of the registries, or a flush that throws, rejects, so the
    // queue tries again.
    handler: async () => {
      await flushEveryContentScope(languageChangeContentCache());
    },
  });
}
