/**
 * Deleting a Layout the plugin created a moment ago and recorded nowhere.
 *
 * The default repair creates a seed Layout and then records it in the settings
 * Single. When that write fails, the seed is recorded nowhere: nothing can
 * find it again, and it would sit in the Layouts list for good. It is deleted
 * at once, and that delete has to pass the Layout guard like any other, so it
 * goes through the same fence: the row, its steps, the copy and the token.
 *
 * Two of Remove Layout's checks are skipped, and why: the seed is not the
 * default (recording it as the default is the write that failed), and no page
 * can name a Layout whose id was never handed to anyone.
 *
 * @module layout-removal/system-remove
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { Nextly } from "nextly";

import { readLayoutCopy } from "./layout-copy";
import { LAYOUT_REMOVAL_CONTEXT_KEY } from "./layout-removal-guard";
import type { LayoutRemovalStore } from "./store";
import { ALREADY_BEING_REMOVED } from "./words";

/** What the delete needs. */
export interface SystemRemoveDeps {
  readonly nextly: Pick<Nextly, "find" | "findByID" | "delete">;
  readonly store: LayoutRemovalStore;
  readonly layouts: string;
  readonly newToken?: () => string;
}

/** Take the fence to its final step and delete the Layout as the system. */
async function fenceAndDelete(
  deps: SystemRemoveDeps,
  id: string,
  token: string
): Promise<boolean> {
  await deps.store.advance({
    layoutId: id,
    token,
    from: "marked",
    to: "checked",
  });
  const taken = await readLayoutCopy(deps.nextly, deps.layouts, id);
  if (taken === null) return false;
  await deps.store.advance({
    layoutId: id,
    token,
    from: "checked",
    to: "final",
    set: { copy: taken.copy, copyVersion: taken.version },
  });
  await deps.nextly.delete({
    collection: deps.layouts,
    id,
    overrideAccess: true,
    context: { [LAYOUT_REMOVAL_CONTEXT_KEY]: token },
  });
  return true;
}

/** Delete the unrecorded Layout `id`, by the rule in the module docblock. */
export async function deleteUnrecordedLayout(
  deps: SystemRemoveDeps,
  id: string
): Promise<void> {
  const token = (deps.newToken ?? (() => globalThis.crypto.randomUUID()))();
  const marked = await deps.store.mark({
    layoutId: id,
    action: "delete",
    token,
    startedBy: null,
    now: new Date(),
  });
  if (marked.kind === "busy") {
    throw NextlyError.conflict({
      reason: "state",
      message: ALREADY_BEING_REMOVED,
      logContext: { reason: "layout-removal-busy", layoutId: id },
    });
  }
  let deleted: boolean;
  try {
    deleted = await fenceAndDelete(deps, id, token);
  } catch (error) {
    await deps.store.stop(id, token).catch(() => false);
    throw error;
  }
  if (!deleted) {
    await deps.store.stop(id, token);
    return;
  }
  await deps.store.advance({
    layoutId: id,
    token,
    from: "final",
    to: "removed",
  });
  await deps.store.settle(id, token);
}
