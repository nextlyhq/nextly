/**
 * Delete lock rows whose claim has lapsed.
 *
 * Expiry is decided by the timestamp on read, so correctness never depends on
 * this having run: a lapsed row is already ignored by every reader. What it
 * costs to skip is space. A row exists per document ever opened, and the table
 * would otherwise grow with the number of distinct documents an installation
 * has edited and never shrink.
 *
 * @module domains/document-lock/document-lock-sweep-job
 */

import { defineJob, type JobDefinition } from "../jobs/job-registry";

import type { DocumentLockService } from "./document-lock-service";

export const DOCUMENT_LOCK_SWEEP_JOB = "document-lock:sweep";

export function createDocumentLockSweepJob(deps: {
  service: DocumentLockService;
}): JobDefinition {
  return defineJob({
    slug: DOCUMENT_LOCK_SWEEP_JOB,
    // A sweep: a claim lapses at an instant with no request attached, and the
    // editor whose claim it was has by definition stopped asking. Nothing is
    // ever in a position to enqueue this, so a trigger keeps one queued.
    sweep: true,
    handler: async () => {
      await deps.service.sweepExpired();
    },
  });
}
