/**
 * Deleting a component the plugin created a moment ago and that nothing
 * places: the starter header or footer of a seed that failed part-way.
 *
 * A component is deleted only at its delete run's `deleting` step (`guards.ts`),
 * so this takes the same road in one go, as the system: it opens the run,
 * which fences the component, moves it to `deleting`, deletes the component
 * with the run's id in the hook context, and leaves the tombstone, as Delete
 * component does.
 *
 * Delete component's check and conversion are skipped, and why: the component
 * was created by this run and its id was handed to no one, so no document can
 * place it. The one thing that could name it, the seed's set, is deleted
 * first by its caller.
 *
 * A delete that fails leaves nothing held: when the component is still there
 * the run is closed, which lifts its fence, so the component can be deleted
 * later through Delete component like any other. When the delete committed
 * before failing, the tombstone is left as for a delete that succeeded.
 *
 * @module component-delete/system-delete
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { Nextly } from "nextly";

import type { FenceStore } from "../host-rewrite/fence";

import { COMPONENT_DELETE_CONTEXT_KEY } from "./job";

/** Who a run opened by the plugin itself is recorded as started by. */
const SYSTEM_STARTER = "system:page-builder";

/** What the delete needs. */
export interface SystemComponentDeleteDeps {
  readonly nextly: Pick<Nextly, "delete" | "find">;
  readonly runs: Pick<
    FenceStore,
    "open" | "advance" | "markDeleted" | "closeRun"
  >;
  /** The RESOLVED collection components are stored in. */
  readonly components: string;
  readonly now?: () => Date;
}

/** Delete the unplaced component `id`, by the rule in the module docblock. */
export async function deleteUnplacedComponent(
  deps: SystemComponentDeleteDeps,
  id: string
): Promise<void> {
  const { opened, run } = await deps.runs.open(
    id,
    "delete",
    SYSTEM_STARTER,
    "preflight"
  );
  if (!opened) {
    // A delete run already holds it: never one this code opened, so it is
    // left to whoever did.
    throw NextlyError.conflict({
      reason: "state",
      message: "This component is already being deleted.",
      logContext: { reason: "component-system-delete-busy", componentId: id },
    });
  }
  await deps.runs.advance(run.id, "preflight", "deleting", null);
  try {
    await deps.nextly.delete({
      collection: deps.components,
      id,
      overrideAccess: true,
      context: { [COMPONENT_DELETE_CONTEXT_KEY]: run.id },
    });
  } catch (error) {
    if (await stillThere(deps, id)) {
      // Not deleted: the fence comes down, and nothing is left held.
      await deps.runs.closeRun(run.id, ["preflight", "deleting"]);
      throw error;
    }
  }
  await deps.runs.markDeleted(
    run.id,
    (deps.now ?? (() => new Date()))().toISOString()
  );
}

/** Whether component `id` is stored, in any state. */
async function stillThere(
  deps: Pick<SystemComponentDeleteDeps, "nextly" | "components">,
  id: string
): Promise<boolean> {
  const found = await deps.nextly.find({
    collection: deps.components,
    where: { id: { equals: id } },
    status: "all",
    limit: 1,
    depth: 0,
    select: { id: true },
    overrideAccess: true,
  });
  return found.items.length > 0;
}
