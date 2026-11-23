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
import type { WhereFilter } from "../collections/query/query-operators";
import { defineJob, type JobDefinition } from "../jobs/job-registry";

import {
  rejectFile,
  UPLOAD_LINK_SECONDS,
  writeFileFields,
} from "./file-uploads";

/** The sweep's job slug. */
const FILE_UPLOAD_SWEEP_JOB = "files:sweep-abandoned";

/**
 * How much longer than its collection's wait the sweep leaves an upload, in
 * seconds. A confirm refuses at the wait itself, so one that began in time is
 * still checking bytes for at most a storage read's deadline; leaving it this
 * long means the sweep never deletes bytes a confirm is about to keep.
 */
const CONFIRM_GRACE_SECONDS = 600;

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

/** Up to {@link PER_PASS} entries of `slug` matching `where`, read as trusted code. */
async function entriesWhere(
  deps: UploadSweepDeps,
  slug: string,
  where: WhereFilter
): Promise<Array<Record<string, unknown> & { id: string }>> {
  const found = unwrapServiceResult<{ docs?: Array<Record<string, unknown>> }>(
    await deps.entries().listEntries({
      collectionName: slug,
      overrideAccess: true,
      depth: 0,
      limit: PER_PASS,
      where,
    }),
    { reason: "file-sweep-not-listed", collection: slug }
  );
  return (found.docs ?? []).map(entry => ({ ...entry, id: String(entry.id) }));
}

/** The time `seconds` before `now`, as the `createdAt` filter takes it. */
function before(now: Date, seconds: number): string {
  return new Date(now.getTime() - seconds * 1000).toISOString();
}

/**
 * Reject every upload of every collection with files that has waited past
 * its collection's wait (and the margin a confirm in progress is given), then
 * clear what any expired upload link may have left: once the link can no
 * longer write, whatever sits at an entry's `uploadKey` beside a confirmed or
 * rejected file is removed and the key forgotten. At most {@link PER_PASS}
 * entries of a collection a step; the next pass takes the rest. Answers how
 * many uploads it rejected. `now` is the time the waits are measured to: the
 * clock's, unless a caller names another.
 */
export async function sweepAbandonedUploads(
  deps: UploadSweepDeps,
  now: Date = new Date()
): Promise<number> {
  let rejected = 0;
  for (const collection of deps.collections()) {
    if (collection.files === undefined) continue;
    const { pendingTimeout } = resolveFilesPolicy(collection.files);
    const files = getMediaStorage().getPrivateFiles(collection.slug);

    const waiting = await entriesWhere(deps, collection.slug, {
      and: [
        // A caller's own create leaves the status unset until the file's
        // fields are written, so unset is waiting too.
        {
          or: [
            { fileStatus: { equals: "pending" } },
            { fileStatus: { exists: false } },
          ],
        },
        {
          createdAt: {
            less_than: before(now, pendingTimeout + CONFIRM_GRACE_SECONDS),
          },
        },
      ],
    });
    for (const entry of waiting) {
      await rejectFile(files, collection.slug, entry, "abandoned");
      rejected++;
    }

    const linksExpired = await entriesWhere(deps, collection.slug, {
      and: [
        { uploadKey: { exists: true } },
        { fileStatus: { in: ["ready", "rejected"] } },
        {
          createdAt: {
            less_than: before(now, UPLOAD_LINK_SECONDS + CONFIRM_GRACE_SECONDS),
          },
        },
      ],
    });
    for (const entry of linksExpired) {
      const { uploadKey, storageKey, fileStatus } = entry;
      // Never the confirmed file itself, should the two keys ever agree.
      const kept = fileStatus === "ready" && uploadKey === storageKey;
      if (typeof uploadKey === "string" && files.owns(uploadKey) && !kept) {
        await files.delete(uploadKey);
      }
      await writeFileFields(collection.slug, entry.id, { uploadKey: null });
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
