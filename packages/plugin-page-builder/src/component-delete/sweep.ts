/**
 * The background job of Delete component: `page-builder:component-delete`.
 *
 * A sweep, and a narrow one. Every write a delete makes is its starter's, in
 * their own requests (`job.ts`), because nothing lets a job act as a stored
 * person. What is left to a job is what needs nobody's rights:
 *
 * - closing a run whose settle window has passed, so the fence against stale
 *   copies of a deleted component does not outlast it when its starter never
 *   calls again;
 * - finishing a run that stopped between the component's delete and the
 *   move to `settling`: the component is gone, so the run settles.
 *
 * A run whose component still exists at `deleting` is its starter's to carry
 * on; the sweep leaves it. Idempotent: each move is a compare-and-set, and a
 * run another pass moved first is simply skipped.
 *
 * @module component-delete/sweep
 */
import { defineJob, type JobDefinition } from "@nextlyhq/plugin-sdk";

import type { DeletionRun, FenceStore } from "../host-rewrite/fence";

import { settled } from "./job";

/** The job type this plugin registers, namespaced by the plugin. */
export const COMPONENT_DELETE_JOB = "page-builder:component-delete";

/** What a pass needs, resolved per pass. */
export interface ComponentDeleteSweepDeps {
  /** Every open run, of every purpose. */
  readonly runs: () => Promise<readonly DeletionRun[]>;
  readonly store: () => Pick<FenceStore, "advance" | "close">;
  /** Whether a component still exists, read as the system. */
  readonly exists: (componentId: string) => Promise<boolean>;
  readonly now: () => Date;
}

/** One pass over the open delete runs. */
export async function sweepComponentDeletes(
  deps: ComponentDeleteSweepDeps
): Promise<void> {
  for (const run of await deps.runs()) {
    if (run.purpose !== "delete") continue;
    if (run.phase === "deleting" && !(await deps.exists(run.componentId))) {
      await deps
        .store()
        .advance(run.id, "deleting", "settling", deps.now().toISOString());
      continue;
    }
    if (run.phase === "settling" && settled(run, deps.now())) {
      await deps.store().close(run.componentId, "delete");
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
