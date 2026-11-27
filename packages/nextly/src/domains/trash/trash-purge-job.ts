/**
 * The trash's clean-up: removes for good every trashed item past its purge
 * date, thirty days after it was trashed.
 *
 * A sweep: an item comes due at an instant with no request attached, so
 * nothing is in a position to enqueue the removal; a queued sweep runs on
 * every pass of the jobs runner instead. When nothing is due it is one
 * indexed read. It is safe to run twice: a record already removed is not
 * there to remove again.
 *
 * @module domains/trash/trash-purge-job
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { defineJob, type JobDefinition } from "../jobs/job-registry";

import { purgeExpiredTrash } from "./trash-records";

export const TRASH_PURGE_JOB = "trash:purge";

export function createTrashPurgeJob(deps: {
  adapter: () => Pick<
    DrizzleAdapter,
    "select" | "transaction" | "getCapabilities" | "tableExists"
  >;
  now?: () => Date;
}): JobDefinition {
  return defineJob({
    slug: TRASH_PURGE_JOB,
    sweep: true,
    handler: async () => {
      await purgeExpiredTrash(deps.adapter(), (deps.now ?? (() => new Date()))());
    },
  });
}
