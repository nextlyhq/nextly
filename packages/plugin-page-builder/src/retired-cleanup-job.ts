/**
 * The background job that takes a component's retired field values out of the
 * documents still holding them.
 *
 * A sweep, for the reason the usage backfill is one: the work is owed by what
 * the retired table holds, whichever path recorded it, and no single request
 * is the moment it becomes due. The runner keeps one queued, and each pass
 * walks the components owed a walk until its deadline, resuming next time
 * where it stopped (`retired-cleanup`).
 *
 * @module retired-cleanup-job
 */
import { defineJob, type JobDefinition } from "@nextlyhq/plugin-sdk";

import type { RetiredCleanupService } from "./retired-cleanup";

/** The job type this plugin registers, namespaced by the plugin. */
export const RETIRED_CLEANUP_JOB = "page-builder:retired-cleanup";

/**
 * Build the cleanup sweep. The service is resolved on every pass, so a pass
 * that ran before the plugin was installed refuses with a named reason rather
 * than walking a half-built configuration.
 */
export function retiredCleanupJob(
  cleanup: () => Pick<RetiredCleanupService, "advance">
): JobDefinition {
  return defineJob({
    slug: RETIRED_CLEANUP_JOB,
    sweep: true,
    handler: async (_input, context) => {
      // The runner's own deadline, read once: the pass checks the live clock
      // against it between documents.
      await cleanup().advance({ deadline: context.deadline });
    },
  });
}
