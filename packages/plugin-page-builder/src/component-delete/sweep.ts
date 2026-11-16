/**
 * The background job of Delete component: `page-builder:component-delete`.
 *
 * A sweep, and a narrow one. Every write a delete makes is its starter's, in
 * their own requests (`job.ts`), because nothing lets a job act as a stored
 * person. What is left to a job is what needs nobody's rights:
 *
 * finishing a run that stopped between the component's delete and its move
 * to `deleted`: the component is gone, so the run becomes its tombstone. A
 * tombstone is never closed: it is what refuses a save still holding the
 * deleted component, however long that save was held.
 *
 * A run whose component still exists at `deleting` is its starter's to carry
 * on; the sweep leaves it. Idempotent: each move is a compare-and-set, and a
 * run another pass moved first is simply skipped.
 *
 * @module component-delete/sweep
 */
import { defineJob, type JobDefinition } from "@nextlyhq/plugin-sdk";

import type { DeletionRun, FenceStore } from "../host-rewrite/fence";

/** The job type this plugin registers, namespaced by the plugin. */
export const COMPONENT_DELETE_JOB = "page-builder:component-delete";

/** What a pass needs, resolved per pass. */
export interface ComponentDeleteSweepDeps {
  /** Every run stopped at its delete, of every purpose. */
  readonly deleting: () => Promise<readonly DeletionRun[]>;
  readonly store: () => Pick<FenceStore, "markDeleted">;
  /** Whether a component still exists, read as the system. */
  readonly exists: (componentId: string) => Promise<boolean>;
  readonly now: () => Date;
}

/** One pass over the open delete runs. */
export async function sweepComponentDeletes(
  deps: ComponentDeleteSweepDeps
): Promise<void> {
  for (const run of await deps.deleting()) {
    if (run.purpose !== "delete" || run.phase !== "deleting") continue;
    if (!(await deps.exists(run.componentId))) {
      // The tombstone, and the run's progress dropped with the move.
      await deps.store().markDeleted(run.id, deps.now().toISOString());
    }
  }
}

/** Build the sweep. */
export function componentDeleteJob(
  deps: () => ComponentDeleteSweepDeps
): JobDefinition {
  return defineJob({
    slug: COMPONENT_DELETE_JOB,
    sweep: true,
    handler: async () => {
      await sweepComponentDeletes(deps());
    },
  });
}
