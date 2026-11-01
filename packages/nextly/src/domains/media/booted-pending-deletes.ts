/**
 * The booted instance's media deletes that can be undone: the marks on its
 * adapter, the ordinary media delete to finish them, and the jobs queue to
 * finish them durably. The one place they are assembled, for the delete and
 * Undo routes, the library's sweep and the finalising job alike.
 *
 * @module domains/media/booted-pending-deletes
 */

import { getService } from "../../di";
import { getNextlyLogger } from "../../observability/logger";
import { enqueueInTransaction } from "../jobs/jobs-repository";

import { MEDIA_FINALIZE_DELETES_JOB } from "./finalize-deletes-job";
import { PendingMediaDeletes } from "./pending-delete";

/** The marks over the booted instance, judged at `now` when one is given. */
export function bootedPendingDeletes(now?: () => Date): PendingMediaDeletes {
  const adapter = getService("adapter");
  const media = getService("mediaService");
  return new PendingMediaDeletes({
    db: adapter,
    deleteItem: (mediaId, actor) => media.delete(mediaId, {}, actor),
    logger: getNextlyLogger(),
    // Queued in the transaction that writes the marks, so the job exists
    // exactly when they do.
    schedule: async (tx, job) => {
      await enqueueInTransaction(tx, adapter.getCapabilities().dialect, {
        slug: MEDIA_FINALIZE_DELETES_JOB,
        input: { ids: [...job.ids] },
        runAt: job.runAt,
        runAsUserId: null,
        now: job.now,
      });
    },
    ...(now ? { now } : {}),
  });
}
