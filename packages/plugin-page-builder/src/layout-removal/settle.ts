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
 * - at `moving`, the person moving the Layout's pages stopped watching it (its
 *   dialog closed): the row is removed and the Layout kept. The pages already
 *   moved stay on the site default, and the rest stay on the Layout; starting
 *   the move again picks them up;
 * - at `final`, the Layout as it is says whether the write landed: still there
 *   (or still published, for an unpublish) and the row is removed; gone and it
 *   is settled as the request would have, an unpublish first looking for pages
 *   published onto it meanwhile ({@link undoUnpublishIfPagesNameIt});
 * - at `removed`, the check after the write is run;
 * - at `restoring`, a restore whose row records the Layout it created is
 *   finished on that Layout; one that stopped before recording it cannot tell
 *   whether its Layout was created, so it is settled and logged rather than
 *   run twice.
 *
 * A row is removed only while it is exactly as the sweep read it: the same
 * token, step and `updatedAt`. A removal that moved on after the read, or
 * renewed its lease during a long scan, is left to the request that holds it.
 *
 * It also drops an unpublish tombstone whose Layout is published again by a
 * write that ran no collection hooks (a batch with `skipHooks`).
 *
 * @module layout-removal/settle
 */
import {
  layoutExists,
  publishedLayoutIds,
  readLayoutSettings,
  type DefaultLayoutDirectApi,
} from "../default-layout/store";

import {
  idChunks,
  namesItOffTheLiveRow,
  scanLayoutReferences,
  stoppedAtBudget,
  type PageReference,
  type ReferenceScan,
} from "./layout-references";
import { LAYOUT_REMOVAL_CONTEXT_KEY } from "./layout-removal-guard";
import { clearPageReference, IN_FLIGHT_CLEARED } from "./page-reference-guard";
import {
  republishFromCopy,
  restoreFromCopy,
  resumeRestore,
  type RestoreDeps,
} from "./restore";
import { movesPages, REMOVAL_LEASE_MS, type LayoutRemoval } from "./store";

/** What the check after the write did. */
export type SettleOutcome =
  /** Nothing raced it: the removal is settled. */
  | "settled"
  /** A promotion raced a delete: the Layout was restored under a new id. */
  | "restored"
  /** A promotion raced an unpublish: the default repair puts the default right. */
  | "left-to-repair"
  /** Another run restored it, or the default moved on meanwhile. */
  | "moved-on"
  /** The scan after the write could not read a page: left to the sweep. */
  | "unchecked";

/** What the check after the write needs beyond a restore. */
export type SettleDeps = RestoreDeps & {
  readonly nextly: RestoreDeps["nextly"] &
    Pick<DefaultLayoutDirectApi, "find" | "findByID">;
  /** The RESOLVED pages slug. */
  readonly pagesSlug: string;
  /** The scans' page-read budget; the default is the scan's own. */
  readonly budget?: number;
};

/**
 * An unpublish's look after its write, the same from the request and from the
 * sweep finishing a request that stopped: scan pages again, live rows
 * included. A page published while the unpublish ran, naming the Layout, would
 * show the site default in its place with nobody having confirmed it; so the
 * Layout is published again from its copy, with the removal's token, and the
 * fence comes down. Answers the scan that found the pages, or `null` when
 * nothing names the Layout and the unpublish stands.
 *
 * For a removal that moved its pages (`movedPages`), a live row naming the
 * Layout was confirmed: the person was told those pages switch to the site
 * default. Only an unpublished page or a working draft counts then.
 */
export async function undoUnpublishIfPagesNameIt(
  deps: Pick<
    SettleDeps,
    "nextly" | "slugs" | "pagesSlug" | "store" | "warn" | "budget"
  >,
  layoutId: string,
  token: string,
  movedPages: boolean
): Promise<ReferenceScan | null> {
  const scanned = await scanLayoutReferences({
    nextly: deps.nextly,
    pages: deps.pagesSlug,
    layoutId,
    ...(deps.budget === undefined ? {} : { budget: deps.budget }),
  });
  const scan = movedPages
    ? {
        ...scanned,
        references: scanned.references.filter(namesItOffTheLiveRow),
      }
    : scanned;
  if (scan.complete && scan.references.length === 0) return null;
  const removal = await deps.store.removalOf(layoutId);
  await republishFromCopy(deps, layoutId, removal?.copy ?? null, {
    [LAYOUT_REMOVAL_CONTEXT_KEY]: token,
  });
  await deps.store.stop(layoutId, token);
  deps.warn(
    "[page-builder] a page was published onto a Layout while it was being unpublished; the Layout was published again",
    { layoutId }
  );
  return scan;
}

/**
 * Clear `layoutId` from one page, answering whether it did. A page that can't
 * be read or written is logged and left, so it does not stop the others being
 * cleared; the page's own after-write look, or the site default it draws,
 * covers it.
 */
async function clearOne(
  deps: SettleDeps,
  pageId: string,
  layoutId: string
): Promise<boolean> {
  try {
    return await clearPageReference(
      deps.nextly,
      deps.pagesSlug,
      pageId,
      layoutId
    );
  } catch (error) {
    deps.warn(
      "[page-builder] a page a Layout removal left on that Layout could not be cleared",
      {
        pageId,
        layoutId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return false;
  }
}

/**
 * Clear the Layout from every page a write in flight left on it: the scan
 * once more, after the removal's own write, clearing each unpublished page and
 * each working draft that names it (`clearPageReference`). A live row is left,
 * since no write changes it without publishing its draft. Never throws: a page
 * that cannot be cleared is logged, and the page's own after-write look, or the
 * site default it draws, covers it.
 *
 * Answers the pages whose live row names the Layout, and whether the check
 * is done: a scan that did not read every page (a page still there that could
 * not be read, or a scan that failed) leaves the removal for the sweep to try
 * again. A scan that stopped at its budget is done, logged, since every retry
 * would stop at the same page; the scan before the write read every page, and
 * a page past the budget left on the Layout draws the site default in its
 * place.
 */
async function clearPagesLeftOnIt(
  deps: SettleDeps,
  removal: LayoutRemoval
): Promise<{ live: PageReference[]; done: boolean }> {
  const live: PageReference[] = [];
  try {
    const scan = await scanLayoutReferences({
      nextly: deps.nextly,
      pages: deps.pagesSlug,
      layoutId: removal.layoutId,
      ...(deps.budget === undefined ? {} : { budget: deps.budget }),
    });
    for (const reference of scan.references) {
      if (reference.place === "live") {
        live.push(reference);
        // A live row is left; a working draft beside it is cleared.
        if (reference.draftToo !== true) continue;
      }
      if (await clearOne(deps, reference.id, removal.layoutId)) {
        deps.warn(
          "[page-builder] a page write in flight was cleared to the site default because its Layout is being removed",
          {
            pageId: reference.id,
            layoutId: removal.layoutId,
            phase: "after-removal",
            reason: IN_FLIGHT_CLEARED,
          }
        );
      }
    }
    if (stoppedAtBudget(scan)) {
      deps.warn(
        "[page-builder] the check after a Layout removal stopped at its page-read budget; pages past it were not checked, and one left on the Layout draws the site default in its place",
        { layoutId: removal.layoutId }
      );
      return { live, done: true };
    }
    if (!scan.complete) {
      deps.warn(
        "[page-builder] the check after a Layout removal could not read every page; the removal is kept and the sweep will try again",
        { layoutId: removal.layoutId, unread: [...scan.unread] }
      );
    }
    return { live, done: scan.complete };
  } catch (error) {
    deps.warn(
      "[page-builder] the pages a Layout removal left could not all be checked; the removal is kept and the sweep will try again",
      {
        layoutId: removal.layoutId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return { live, done: false };
  }
}

/**
 * What the check after the write did, and the pages whose LIVE row still
 * names the Layout: a page published while the removal ran, which no write
 * can change without publishing its draft.
 */
export interface SettledRemoval {
  readonly outcome: SettleOutcome;
  readonly live: readonly PageReference[];
}

/** Run the check after the write for a removal whose write has committed. */
export async function settleRemoval(
  deps: SettleDeps,
  removal: LayoutRemoval
): Promise<SettledRemoval> {
  const cleared = await clearPagesLeftOnIt(deps, removal);
  // Not settled while a page went unread: the row and its copy stay, and the
  // sweep runs this check again.
  if (!cleared.done) return { outcome: "unchecked", live: cleared.live };
  return { outcome: await settleDefault(deps, removal), live: cleared.live };
}

/** The default half of the check after the write. */
async function settleDefault(
  deps: SettleDeps,
  removal: LayoutRemoval
): Promise<SettleOutcome> {
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
    await deps.store.stopStale(removal);
    return;
  }
  if (
    removal.action === "unpublish" &&
    (await undoUnpublishIfPagesNameIt(
      deps,
      removal.layoutId,
      removal.token,
      movesPages(removal)
    )) !== null
  ) {
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
    case "moving":
    case "checked":
      // Nothing of the Layout's was changed yet. A move's pages already moved
      // stay moved: the move is stopped, never undone.
      await deps.store.stopStale(removal);
      return;
    case "final":
      await finishFinal(deps, removal);
      return;
    case "removed":
      await settleRemoval(deps, removal);
      return;
    case "restoring":
      // A row that records its Layout is finished, or settled when that
      // Layout was deleted since, by the resume itself.
      if (removal.copy?.restoredAs !== undefined) {
        await resumeRestore(deps, removal);
        return;
      }
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
  await finishStoppedRemovals(deps);
  await releasePublishedTombstones(deps);
}

/**
 * Drop each unpublish tombstone whose Layout is published again. A publish
 * normally drops it from the Layout's own after-write hook, but a write that
 * skips hooks (a batch with `skipHooks`) runs none, and would otherwise leave a
 * published Layout that make-default refuses as being removed.
 *
 * Asked in chunks ({@link idChunks}), each released on its own, so however many
 * tombstones build up, no lookup passes the database's bound parameters and
 * one chunk that fails leaves the rest released. Never throws.
 */
async function releasePublishedTombstones(deps: SweepDeps): Promise<void> {
  let tombstones: LayoutRemoval[];
  try {
    tombstones = await deps.store.tombstones();
  } catch (error) {
    warnTombstones(deps, error);
    return;
  }
  for (const chunk of idChunks(tombstones.map(removal => removal.layoutId))) {
    try {
      const published = await publishedLayoutIds(
        deps.nextly,
        deps.slugs,
        chunk
      );
      for (const id of published) await deps.store.releaseTombstone(id);
    } catch (error) {
      warnTombstones(deps, error);
    }
  }
}

/** Log a tombstone check that failed; the next sweep tries again. */
function warnTombstones(deps: SweepDeps, error: unknown): void {
  deps.warn(
    "[page-builder] the unpublish records of Layouts published again could not be checked; the next sweep will try again",
    { error: error instanceof Error ? error.message : String(error) }
  );
}

/** The rows stopped requests left, each finished or cleared. */
async function finishStoppedRemovals(deps: SweepDeps): Promise<void> {
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
