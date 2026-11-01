/**
 * The job that finishes a media delete once its Undo window has ended.
 *
 * A delete marks its items and queues one of these in the same transaction,
 * to run at the window's end, so a delete is finished by the jobs queue even
 * when nothing else is left to finish it: the request's worker gone (a
 * serverless function, a restart) and no one reading the library. The jobs
 * queue is the durable mechanism every deployment already triggers
 * (`/api/jobs/run`), which releases, webhooks and queued email ride too.
 *
 * The delete's own timer still finishes it at once on a server that keeps
 * running, and the library's reads still sweep any mark left due; whichever
 * comes first takes each mark by the one guarded statement
 * (`PendingMediaDeletes`), so this is idempotent: an item already finished,
 * or brought back by Undo, has no mark left and is passed over. A delete that
 * fails puts its mark back, already due, and the job is tried again.
 *
 * @module domains/media/finalize-deletes-job
 */

import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import { defineJob, type JobDefinition } from "../jobs/job-registry";

import type { PendingMediaDeletes } from "./pending-delete";

/** The slug the job is queued and registered under. */
export const MEDIA_FINALIZE_DELETES_JOB = "nextly:media-finalize-deletes";

/**
 * Attempts before the job is given up on: with the queue's backoff from one
 * second, about a quarter of an hour. The library's reads still sweep a mark
 * left after that.
 */
const MAX_ATTEMPTS = 10;

/** What the job is queued with: the items one delete marked. */
const finalizeInputSchema = z.object({
  ids: z.array(z.string().min(1)),
});

export type MediaFinalizeDeletesInput = z.infer<typeof finalizeInputSchema>;

/**
 * The job, over the marks as `pending(now)` builds them, judging each
 * deadline at the pass's own `now`.
 */
export function createMediaFinalizeDeletesJob(
  pending: (now: Date) => Promise<PendingMediaDeletes>
): JobDefinition<MediaFinalizeDeletesInput> {
  return defineJob<MediaFinalizeDeletesInput>({
    slug: MEDIA_FINALIZE_DELETES_JOB,
    retry: { maxAttempts: MAX_ATTEMPTS },
    handler: async (input, context) => {
      const read = finalizeInputSchema.safeParse(input);
      // A row whose input names no items has nothing to finish.
      if (!read.success) return;
      const deletes: PendingMediaDeletes = await pending(context.now);
      await deletes.finalizeMarked(read.data.ids);
      // A mark still due is a delete that failed and was put back: thrown,
      // so the queue tries again. A mark not yet due is another delete's,
      // made after an Undo, and that delete's own job finishes it.
      const left = await deletes.dueAmong(read.data.ids);
      if (left.length > 0) {
        throw NextlyError.internal({
          logContext: { reason: "media-delete-not-finished", left },
        });
      }
    },
  });
}
