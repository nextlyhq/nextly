/**
 * How much of the usage index is actually there, asked ONCE for a whole screen.
 *
 * A usage count is a floor rather than a total for reasons that are properties
 * of the INDEX rather than of the component being counted, and this is where
 * they are answered. Both are the same answer for every tile on a screen, which
 * is why they are read here instead of inside the count: a component library
 * renders a tile per component and asks each one for a number, so a
 * per-component version of this question would issue the identical index-wide
 * read once per tile — a hundred duplicate queries to learn one fact, against
 * the pool the index exists to keep free.
 *
 * ## Why this is not a cache
 *
 * It is read once and held for the render that asked. Nothing invalidates it,
 * because nothing needs to: the answer only ever moves from "a floor" towards
 * "whole", so a screen showing a caveat a few seconds after it stopped being
 * necessary is the harmless direction. A screen that dropped the caveat early
 * is the other one.
 *
 * @module usage-index-health
 */
import { backfillComplete } from "./usage-backfill";
import type { BackfillScope } from "./usage-backfill-scope";
import type {
  GroupedUsageReader,
  UsageIndex,
  UsageSubject,
} from "./usage-index";

/** What is known about the index as a whole, at one moment. */
export interface UsageIndexHealth {
  /**
   * Whether the index covers documents that existed before it did.
   *
   * The write hooks maintain it going FORWARD. Nothing fills it for documents
   * already stored when the plugin was installed, or when a version added an
   * index, so on such a site a component used on hundreds of pages has no rows
   * at all — and no row is indistinguishable from a component nothing uses,
   * which is the answer a delete decision acts on.
   *
   * FALSE until a backfill exists, and that is a statement about this package
   * rather than about any particular site: there is no mechanism yet that fills
   * the index for existing documents, so nothing can honestly report otherwise.
   * A site that installed the plugin before creating any content is in fact
   * fully covered, and this still answers false — the plugin cannot tell the
   * two apart, and the conservative reading is the one that does not invite a
   * delete.
   */
  coversExistingDocuments: boolean;
  /**
   * Whether any document in the index could not be read whole.
   *
   * Index-wide rather than per component, and that is the point: a document
   * that exceeded its walk bound has its discovered references DISCARDED and
   * one marker stored, so it is missing from every count rather than wrong in
   * one of them. A marker names no component, so "which unreadable documents
   * reference this one" is the question the marker exists because nothing can
   * answer.
   */
  anyUndetermined: boolean;
  /**
   * Whether a maintenance write failed since the last run that walked every
   * scope.
   *
   * A save whose index write failed leaves that document's rows stale, and no
   * later save of another document repairs them. The mark is cleared only by a
   * backfill run that started after the failure and walked the whole site.
   *
   * Optional so a health value built by a caller before this field existed
   * still type-checks; `readUsageIndexHealth` always sets it.
   */
  dirty?: boolean;
  /**
   * Whether the backfill still has work that will move this answer: a scope
   * that exists now not yet walked under the current derivation, or a run
   * owed since a maintenance write failed.
   *
   * Told apart from the rest of "not whole" because only this resolves on its
   * own. Content the index cannot reach (a blocks-backed Single) or a
   * document past its walk bound keeps the index a floor however long a
   * screen waits, and a screen that re-read on a timer would read forever.
   *
   * Optional for the reason `dirty` is; absent reads as nothing pending.
   */
  backfillPending?: boolean;
}

/** Whether the index can answer for the whole population it claims to cover. */
export function indexIsWhole(health: UsageIndexHealth): boolean {
  return (
    health.coversExistingDocuments &&
    !health.anyUndetermined &&
    health.dirty !== true
  );
}

/**
 * Whether a non-whole index may still become whole without anything else
 * changing, so a screen showing floors has a reason to ask again. False for a
 * whole index, and for one only content out of reach keeps from whole.
 */
export function indexStillCounting(health: UsageIndexHealth): boolean {
  return !indexIsWhole(health) && health.backfillPending === true;
}

/**
 * Why an index the backfill has nothing left to do for is still not whole,
 * or undefined where it is whole or still counting. Each is a reason no run
 * of the backfill can remove, so a caller that would otherwise count again
 * says it instead:
 *
 * - `undetermined`: a document past its walk bound, whose uses are not
 *   counted at all (`anyUndetermined`);
 * - `unreachable`: content the index cannot address, such as a blocks field
 *   nested under a named group (`coversExistingDocuments` false with every
 *   scope walked).
 */
export type UsageCoverageGap = "undetermined" | "unreachable";

export function usageCoverageGap(
  health: UsageIndexHealth
): UsageCoverageGap | undefined {
  if (indexIsWhole(health) || indexStillCounting(health)) return undefined;
  return health.anyUndetermined ? "undetermined" : "unreachable";
}

/** The backfill's bookkeeping as health reads it, from one snapshot. */
export interface UsageProgressReading {
  /** Whether the recorded run was walked under the derivation in force now. */
  current: boolean;
  /** Whether a maintenance write failed since the last finished run. */
  dirty: boolean;
  /** The scope keys the current run has walked whole. */
  completed: ReadonlySet<string>;
}

/**
 * Read the index-wide facts, in as few queries as they need.
 *
 * The marker probe is a grouped read exactly like a count, so it goes through
 * the same injected reader and needs no second capability.
 */
export async function readUsageIndexHealth<TRow extends UsageSubject>(args: {
  index: UsageIndex<TRow>;
  read: GroupedUsageReader;
  /**
   * How to ask whether the backfill has finished, when the caller can.
   *
   * OPTIONAL, and the default is the conservative answer rather than a
   * convenience. A caller that cannot supply this — anything outside the
   * plugin, which is where the scopes and the progress store are assembled —
   * gets `coversExistingDocuments: false`, so its counts read as floors. That
   * is the honest answer for a caller that genuinely cannot tell, and it is the
   * direction that does not invite a delete.
   */
  backfill?: {
    /** Every scope that exists now. */
    scopes: () => Promise<readonly BackfillScope[]>;
    /**
     * The run, its progress and the dirty mark, read together from ONE
     * snapshot, so the progress is the recorded run's and not a newer one's.
     */
    progress: () => Promise<UsageProgressReading>;
    /**
     * Whether content exists that this index cannot cover AT ALL.
     *
     * Separate from "not yet walked", because the remedy is different and so is
     * the honesty. An unwalked scope becomes walked; unreachable content stays
     * unreachable until the plugin learns to reach it, so a backfill that
     * finished every scope it CAN see must still not claim the index covers the
     * site. A blocks field nested under a named group, in a collection or a
     * Single, is the case today: no row can name where it is stored.
     */
    unreachable: () => Promise<boolean>;
  };
}): Promise<UsageIndexHealth> {
  // The bookkeeping first, then the markers. A walk writes its `unreadable`
  // markers before it records the scope as done, so a scope seen as done has
  // its markers already committed, and the read that follows sees them. The
  // plugin's own service reads both from one snapshot instead.
  const progress =
    args.backfill === undefined
      ? undefined
      : await backfillReading(args.backfill);
  const markers = await args.read({
    where: args.index.whereUndetermined(),
    groupBy: "entityKey",
  });
  // Existence, not how many. One unreadable document is enough to make every
  // count a floor, and `truncated` on this read only means there are more of
  // them than the cap — which does not change the answer.
  return usageIndexHealthFrom(progress, markers.buckets.length > 0);
}

/** What health is decided from: the scopes, the recorded run, and what is out of reach. */
export interface UsageBackfillReading {
  /** Every scope that exists now. */
  scopes: readonly BackfillScope[];
  /** The run, its progress and the dirty mark, from one snapshot. */
  progress: UsageProgressReading;
  /** Whether content exists this index cannot cover at all. */
  unreachable: boolean;
}

/** The three backfill facts, each asked once. */
async function backfillReading(backfill: {
  scopes: () => Promise<readonly BackfillScope[]>;
  progress: () => Promise<UsageProgressReading>;
  unreachable: () => Promise<boolean>;
}): Promise<UsageBackfillReading> {
  const [scopes, progress, unreachable] = await Promise.all([
    backfill.scopes(),
    backfill.progress(),
    backfill.unreachable(),
  ]);
  return { scopes, progress, unreachable };
}

/**
 * Health, from facts already read. `backfill` absent is a caller that cannot
 * say how far the backfill got: not covered, and no mark known, so not whole,
 * and no run this can see will change that.
 */
export function usageIndexHealthFrom(
  backfill: UsageBackfillReading | undefined,
  anyUndetermined: boolean
): UsageIndexHealth {
  const progress = backfillFinished(backfill);
  return {
    coversExistingDocuments: progress.covers,
    anyUndetermined,
    dirty: progress.dirty,
    backfillPending: progress.pending,
  };
}

/**
 * Whether every scope that exists now has been walked under the current
 * derivation.
 *
 * Recomputed against the scopes that exist NOW rather than read from a stored
 * flag. A flag is true about the site it was written for; add a collection, a
 * locale or drafts and there are scopes nothing has walked while the flag still
 * says the index is whole.
 */
function backfillFinished(backfill: UsageBackfillReading | undefined): {
  covers: boolean;
  dirty: boolean;
  pending: boolean;
} {
  if (backfill === undefined) {
    return { covers: false, dirty: false, pending: false };
  }
  const { scopes, progress, unreachable } = backfill;
  // All three, and none implies another. Every scope walked under the current
  // derivation says the work this index CAN do is done; unreachable content
  // says there is content it cannot do at all; a site can be in any mix.
  const walked =
    progress.current && backfillComplete(scopes, progress.completed);
  return {
    covers: walked && !unreachable,
    dirty: progress.dirty,
    // Work the backfill will still do: scopes to walk, or a run owed since a
    // failed write. Unreachable content is not among it.
    pending: !walked || progress.dirty,
  };
}
