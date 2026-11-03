/**
 * A removal's check after its write, and the sweep that finishes or clears
 * the removals a request left part-way.
 *
 * ## The check after the write
 *
 * The removal read the default twice before it wrote, but a promotion can
 * commit between that last read and the delete or unpublish. So once the
 * write has committed, the default is read again:
 *
 * - it names this Layout, and it was deleted: the Layout is restored from the
 *   copy under a new id and the default points at it (`restore.ts`);
 * - it names this Layout, and it was unpublished: left to the default repair,
 *   which the default guard queues after the write, since undoing the
 *   unpublish would publish the Layout's working draft along with it;
 * - otherwise the removal is settled: the copy is dropped, and the row stays
 *   as the record that the Layout was removed.
 *
 * First, every page a write in flight left on the Layout (its unpublished row
 * or its working draft) has the Layout cleared, so no page is left naming a
 * Layout that is gone.
 *
 * ## The sweep
 *
 * Runs with the default repair on every jobs pass. A removal is one request,
 * so a row older than the lease belongs to a request that stopped:
 *
 * - at `marked` or `checked` nothing was changed yet, so the row is removed;
 * - at `final`, the Layout as it is says whether the write landed: still there
 *   (or still published, for an unpublish) and the row is removed; gone and it
 *   is settled as the request would have;
 * - at `removed`, the check after the write is run;
 * - at `restoring`, a restore that stopped part-way cannot tell whether its
 *   Layout was created, so it is settled and logged rather than run twice.
 *
 * @module layout-removal/settle
 */
import {
  layoutExists,
  publishedLayoutIds,
  readLayoutSettings,
  type DefaultLayoutDirectApi,
} from "../default-layout/store";

import { scanLayoutReferences } from "./layout-references";
import { clearPageReference } from "./page-reference-guard";
import { restoreFromCopy, type RestoreDeps } from "./restore";
import { REMOVAL_LEASE_MS, type LayoutRemoval } from "./store";

/** What the check after the write did. */
export type SettleOutcome =
  /** Nothing raced it: the removal is settled. */
  | "settled"
  /** A promotion raced a delete: the Layout was restored under a new id. */
  | "restored"
  /** A promotion raced an unpublish: the default repair puts the default right. */
  | "left-to-repair"
  /** Another run restored it, or the default moved on meanwhile. */
  | "moved-on";

/** What the check after the write needs beyond a restore. */
export type SettleDeps = RestoreDeps & {
  readonly nextly: RestoreDeps["nextly"] &
    Pick<DefaultLayoutDirectApi, "find" | "findByID">;
  /** The RESOLVED pages slug. */
  readonly pagesSlug: string;
};

/**
 * Clear the Layout from every page a write in flight left on it: the scan
 * once more, after the removal's own write, clearing each unpublished page and
 * each working draft that names it (`clearPageReference`). A live row is left,
 * since no write changes it without publishing its draft. Never throws: a page
 * that cannot be cleared is logged, and the page's own after-write look, or the
 * site default it draws, covers it.
 */
async function clearPagesLeftOnIt(
  deps: SettleDeps,
  removal: LayoutRemoval
): Promise<void> {
  try {
    const scan = await scanLayoutReferences({
      nextly: deps.nextly,
      pages: deps.pagesSlug,
      layoutId: removal.layoutId,
    });
    for (const reference of scan.references) {
      if (reference.place === "live") continue;
      if (
        await clearPageReference(
          deps.nextly,
          deps.pagesSlug,
          reference.id,
          removal.layoutId
        )
      ) {
        deps.warn(
          "[page-builder] a page saved while its Layout was being removed named that Layout; its Layout was cleared",
          { pageId: reference.id, layoutId: removal.layoutId }
        );
      }
    }
  } catch (error) {
    deps.warn(
      "[page-builder] the pages a Layout removal left could not all be checked",
      {
        layoutId: removal.layoutId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}

/** Run the check after the write for a removal whose write has committed. */
export async function settleRemoval(
  deps: SettleDeps,
  removal: LayoutRemoval
): Promise<SettleOutcome> {
  await clearPagesLeftOnIt(deps, removal);
  const { defaultLayout } = await readLayoutSettings(deps.nextly, deps.slugs);
  if (defaultLayout === removal.layoutId) {
    if (removal.action === "delete") {
      return (await restoreFromCopy(deps, removal)) === null
        ? "moved-on"
        : "restored";
    }
    deps.warn(
      "[page-builder] a Layout was made the default while it was being unpublished; the default repair will point the default at a published Layout",
      { layoutId: removal.layoutId }
    );
    await deps.store.settle(removal.layoutId, removal.token);
    return "left-to-repair";
  }
  await deps.store.settle(removal.layoutId, removal.token);
  return "settled";
}

/** What the sweep needs beyond the check after the write. */
export type SweepDeps = SettleDeps & {
  readonly now?: () => Date;
};

/** Whether a row was last moved longer ago than the lease. */
function isStale(removal: LayoutRemoval, now: Date): boolean {
  return now.getTime() - removal.updatedAt.getTime() > REMOVAL_LEASE_MS;
}

/** Whether a removal's write landed: the Layout is gone, or unpublished. */
export async function writeLanded(
  deps: Pick<SweepDeps, "nextly" | "slugs">,
  removal: Pick<LayoutRemoval, "action" | "layoutId">
): Promise<boolean> {
  if (removal.action === "delete") {
    return !(await layoutExists(deps.nextly, deps.slugs, removal.layoutId));
  }
  const published = await publishedLayoutIds(deps.nextly, deps.slugs, [
    removal.layoutId,
  ]);
  return !published.has(removal.layoutId);
}

/** Finish one row a stopped request left at `final`. */
async function finishFinal(
  deps: SweepDeps,
  removal: LayoutRemoval
): Promise<void> {
  if (!(await writeLanded(deps, removal))) {
    await deps.store.stop(removal.layoutId, removal.token);
    return;
  }
  const moved = await deps.store.advance({
    layoutId: removal.layoutId,
    token: removal.token,
    from: "final",
    to: "removed",
  });
  if (moved) await settleRemoval(deps, { ...removal, step: "removed" });
}

/** Finish or clear one row a stopped request left behind. */
async function sweepOne(
  deps: SweepDeps,
  removal: LayoutRemoval
): Promise<void> {
  switch (removal.step) {
    case "marked":
    case "checked":
      await deps.store.stop(removal.layoutId, removal.token);
      return;
    case "final":
      await finishFinal(deps, removal);
      return;
    case "removed":
      await settleRemoval(deps, removal);
      return;
    case "restoring":
      deps.warn(
        "[page-builder] a Layout's restore stopped part-way; check the Layouts list for a restored copy",
        { layoutId: removal.layoutId }
      );
      await deps.store.settle(removal.layoutId, removal.token, "restoring");
      return;
  }
}

/**
 * Finish or clear every removal a stopped request left, by the rules in the
 * module docblock. Each row is handled on its own, so one that fails is
 * logged and the rest still run.
 */
export async function settleLayoutRemovals(deps: SweepDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  for (const removal of await deps.store.unsettled()) {
    if (!isStale(removal, now)) continue;
    try {
      await sweepOne(deps, removal);
    } catch (error) {
      deps.warn(
        "[page-builder] a Layout removal left part-way could not be finished; the next sweep will try again",
        {
          layoutId: removal.layoutId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }
}
