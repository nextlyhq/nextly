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
 * Done only when every tag expired or was recorded where every instance reads
 * it: a tag kept in the running process alone is lost with it, so the attempt
 * fails and the queue tries again. A row's attempts are bounded, as every job
 * type's are, and an expiry still owed must outlive them: its last attempts
 * queue a successor, a fresh row with attempts of its own, before failing.
 *
 * A row queued ahead of a grants write (`WriteAheadInput`) does not end at its
 * run either: it may run before a write that outlasts the margin commits, so
 * until the expiry after that write confirms it, each run first queues the
 * next link of its chain, its delay doubling, and the chain ends at the
 * horizon. A row without that input ends at its run.
 *
 * @module domains/grants-content-expiry-job
 */
import { z } from "zod";

import { languageChangeContentCache } from "../di/registrations/language-change-content-cache";

import {
  GRANTS_CONTENT_EXPIRY_JOB,
  WRITE_AHEAD_HORIZON_MS,
  WRITE_AHEAD_LAST_LINK,
  WRITE_AHEAD_MARGIN_MS,
  expireEveryContentScopeForGood,
  writeAheadKey,
  type WriteAheadInput,
} from "./flush-content-change";
import { BACKOFF_CAP_MS } from "./jobs/job-backoff";
import { defineJob, type JobDefinition } from "./jobs/job-registry";
import type { JobsRepository } from "./jobs/jobs-repository";

/**
 * Attempts a row gets before it is given up on: with the queue's backoff, from
 * one second doubling to an hour, about half a day of failures.
 */
const MAX_ATTEMPTS = 24;

/**
 * How many of a row's last attempts queue its successor when they fail. More
 * than one, so a successor the queue refuses in the same outage is asked for
 * again an hour later; one key per row, so asking again adds no second one.
 */
const SUCCESSOR_ATTEMPTS = 3;

/** A stored row's input, read as a write-ahead row's or as none. */
const writeAheadInput = z.object({
  ahead: z.object({
    chain: z.string().min(1),
    link: z.number().int().min(0),
    startedAt: z.number(),
  }),
});

/**
 * Queues the next link of a write-ahead row's chain, before its expiry runs, so
 * a write still open when this runs leaves a row waiting for its commit. None
 * past the horizon or the last link. Rejects when the queue refuses it, so the
 * row is tried again and asks again; the link's key keeps that to one row.
 */
async function queueNextLink(
  jobs: Pick<JobsRepository, "enqueue">,
  input: unknown,
  now: Date
): Promise<void> {
  const read = writeAheadInput.safeParse(input);
  if (!read.success) return;
  const { chain, link, startedAt } = read.data.ahead;
  if (now.getTime() - startedAt >= WRITE_AHEAD_HORIZON_MS) return;
  if (link >= WRITE_AHEAD_LAST_LINK) return;
  const next = link + 1;
  const ahead: WriteAheadInput = { ahead: { chain, link: next, startedAt } };
  await jobs.enqueue({
    slug: GRANTS_CONTENT_EXPIRY_JOB,
    input: ahead,
    runAt: new Date(now.getTime() + WRITE_AHEAD_MARGIN_MS * 2 ** next),
    runAsUserId: null,
    dedupeKey: writeAheadKey(chain, next),
    now,
  });
}

export function createGrantsContentExpiryJob(deps: {
  /** Where a successor is queued. */
  jobs: () => Pick<JobsRepository, "enqueue">;
}): JobDefinition<WriteAheadInput | null> {
  return defineJob<WriteAheadInput | null>({
    slug: GRANTS_CONTENT_EXPIRY_JOB,
    retry: { maxAttempts: MAX_ATTEMPTS },
    handler: async (input, context) => {
      await queueNextLink(deps.jobs(), input, context.now);
      try {
        await expireEveryContentScopeForGood(languageChangeContentCache());
      } catch (error) {
        // A failed read of the registries, a flush that throws, or a tag left
        // unrecorded: rejected, so the queue tries again. Near the end of this
        // row's attempts the expiry is owed past it, by a successor.
        if (context.attempt > MAX_ATTEMPTS - SUCCESSOR_ATTEMPTS) {
          await deps
            .jobs()
            .enqueue({
              slug: GRANTS_CONTENT_EXPIRY_JOB,
              input: null,
              // An hour on, as this row's own retries are spaced by then, so
              // the two do not run side by side.
              runAt: new Date(context.now.getTime() + BACKOFF_CAP_MS),
              runAsUserId: null,
              dedupeKey: `${GRANTS_CONTENT_EXPIRY_JOB}:after:${context.jobId}`,
              now: context.now,
            })
            // Not queued this time: a later attempt of this row asks again.
            .catch(() => undefined);
        }
        throw error;
      }
    },
  });
}
