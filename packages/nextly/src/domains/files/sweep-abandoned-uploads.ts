/**
 * The clean-up of uploads never confirmed.
 *
 * An upload started and never confirmed leaves an entry waiting and, often,
 * bytes in storage that nothing checked. Past its collection's
 * `pendingTimeout`, each is rejected as `abandoned`: its bytes deleted first,
 * then its entry marked. A sweep keeps one run queued at all times, so the
 * job runner (`/admin/api/jobs/run`, which a scheduler calls) runs it on every
 * pass. Running it twice does nothing more: a rejected entry is no longer
 * waiting.
 *
 * @module domains/files/sweep-abandoned-uploads
 * @experimental
 */
import {
  resolveFilesPolicy,
  type CollectionFilesConfig,
} from "../../collections/config/collection-files";
import { unwrapServiceResult } from "../../dispatcher/helpers/service-envelope";
import type { CollectionsHandler } from "../../services/collections-handler";
import { getMediaStorage } from "../../storage/storage";
import { defineJob, type JobDefinition } from "../jobs/job-registry";

import { rejectFile } from "./file-uploads";

/** The sweep's job slug. */
const FILE_UPLOAD_SWEEP_JOB = "files:sweep-abandoned";

/** How many waiting uploads of one collection a pass handles at most. */
const PER_PASS = 50;

/** What the sweep reads: the configured collections and their entries. */
export interface UploadSweepDeps {
  collections: () => ReadonlyArray<{
    slug: string;
    files?: CollectionFilesConfig;
  }>;
  /** Read when a pass runs, so registering the job needs no service yet. */
  entries: () => CollectionsHandler;
}

/**
 * Reject every upload of every collection with files that has waited past
 * its collection's wait, at most {@link PER_PASS} per collection a pass; the
 * next pass takes the rest. Answers how many it rejected. `now` is the time
 * the waits are measured to: the clock's, unless a caller names another.
 */
export async function sweepAbandonedUploads(
  deps: UploadSweepDeps,
  now: Date = new Date()
): Promise<number> {
  let rejected = 0;
  for (const collection of deps.collections()) {
    if (collection.files === undefined) continue;
    const { pendingTimeout } = resolveFilesPolicy(collection.files);
    const cutoff = new Date(
      now.getTime() - pendingTimeout * 1000
    ).toISOString();
    const waiting = unwrapServiceResult<{
      docs?: Array<Record<string, unknown>>;
    }>(
      await deps.entries().listEntries({
        collectionName: collection.slug,
        overrideAccess: true,
        depth: 0,
        limit: PER_PASS,
        where: {
          and: [
            // A caller's own create leaves the status unset until the file's
            // fields are written, so unset is waiting too.
            {
              or: [
                { fileStatus: { equals: "pending" } },
                { fileStatus: { exists: false } },
              ],
            },
            { createdAt: { less_than: cutoff } },
          ],
        },
      }),
      { reason: "file-sweep-not-listed", collection: collection.slug }
    );
    const files = getMediaStorage().getPrivateFiles(collection.slug);
    for (const entry of waiting.docs ?? []) {
      await rejectFile(
        files,
        collection.slug,
        { ...entry, id: String(entry.id) },
        "abandoned"
      );
      rejected++;
    }
  }
  return rejected;
}

/** The sweep as a job, kept queued so every pass of the runner runs it. */
export function createUploadSweepJob(deps: UploadSweepDeps): JobDefinition {
  return defineJob({
    slug: FILE_UPLOAD_SWEEP_JOB,
    sweep: true,
    handler: async () => {
      await sweepAbandonedUploads(deps);
    },
  });
}
