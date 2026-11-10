/**
 * The background job that carries a breakpoint removal on when nobody else
 * will.
 *
 * A removal is walked by the save that started it and by its route, both
 * asked by a person. A write committed after a removal was done can open it
 * again (`after-commit`), and nobody is then waiting on it: the person who
 * removed the breakpoint was told it was finished, and the write that brought
 * the values back was somebody else's save. Without this the reopened run
 * would hold the one open slot, and keep the breakpoint from being added
 * again, until someone happened to call the route.
 *
 * A sweep, for the reason the usage backfill is one: what is owed is in the
 * runs table, whichever path put it there, and no single request is the
 * moment it becomes due. Each pass walks the owed run until the runner's
 * deadline and resumes on the next pass where it stopped. A walk that meets a
 * request walking the same run is safe: every write carries the hash of the
 * value it was computed from, and every move of the run is a compare-and-set.
 *
 * Each pass also deletes what removals took out of the site once it is past
 * the window they can be undone in (`fragments`).
 *
 * @module breakpoint-removal/job
 */
import { defineJob, type JobDefinition } from "@nextlyhq/plugin-sdk";

import { FRAGMENTS_KEPT_DAYS } from "./fragments";
import type { BreakpointRemovalService } from "./service";

/** A day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The job type this plugin registers, namespaced by the plugin. */
export const BREAKPOINT_REMOVAL_JOB = "page-builder:breakpoint-removal";

/**
 * Build the sweep. The service is resolved on every pass, so a pass that ran
 * before the plugin was installed refuses with a named reason rather than
 * walking a half-built configuration.
 */
export function breakpointRemovalJob(
  service: () => Pick<BreakpointRemovalService, "carryOn" | "purgeFragments">
): JobDefinition {
  return defineJob({
    slug: BREAKPOINT_REMOVAL_JOB,
    sweep: true,
    handler: async (_input, context) => {
      // The runner's own deadline: the walk checks the live clock against it
      // between documents.
      // The purge runs whether or not the walk does: a walk failing on every
      // pass must not keep rows past the window. The walk's failure is still
      // the pass's, once the purge is done.
      let walkFailed: { error: unknown } | undefined;
      try {
        await service().carryOn({ deadline: context.deadline });
      } catch (error) {
        walkFailed = { error };
      }
      await service().purgeFragments(
        new Date(Date.now() - FRAGMENTS_KEPT_DAYS * DAY_MS)
      );
      if (walkFailed !== undefined) throw walkFailed.error;
    },
  });
}
