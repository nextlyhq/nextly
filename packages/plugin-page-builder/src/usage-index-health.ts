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
import { backfillComplete, type BackfillStateStore } from "./usage-backfill";
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
}

/** Whether the index can answer for the whole population it claims to cover. */
export function indexIsWhole(health: UsageIndexHealth): boolean {
  return health.coversExistingDocuments && !health.anyUndetermined;
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
    /** Where completed scopes are recorded, for the current generation. */
    state: BackfillStateStore;
    /**
     * Whether content exists that this index cannot cover AT ALL.
     *
     * Separate from "not yet walked", because the remedy is different and so is
     * the honesty. An unwalked scope becomes walked; unreachable content stays
     * unreachable until the plugin learns to reach it, so a backfill that
     * finished every scope it CAN see must still not claim the index covers the
     * site.
     *
     * Singles are the case today: a plugin has no supported way to read one —
     * the available path CREATES the row when absent — so `writeTargetOf`
     * declines every `single:` hook and no scope is enumerated for them. A site
     * whose homepage is a blocks-backed Single would otherwise have every
     * collection scope recorded and be told the index is whole, while the
     * component that homepage renders reads as used by nothing.
     */
    unreachable: () => Promise<boolean>;
  };
}): Promise<UsageIndexHealth> {
  // SEQUENTIAL, and the order is the point rather than a missed optimisation.
  //
  // A rebuild writes its `unreadable` markers and THEN records the scope as
  // complete. Read in parallel, the marker probe can land before a document is
  // processed while the completion read lands after the row is written — so the
  // two observations come from either side of that write and combine into
  // "backfilled, nothing unreadable", which is the one answer that presents an
  // incomplete index as exact.
  //
  // Reading completion first preserves the writer's ordering: if completion is
  // observed, every marker that scope produced was already written, so the
  // probe that follows sees them.
  const covers = await backfillFinished(args.backfill);
  const markers = await args.read({
    where: args.index.whereUndetermined(),
    groupBy: "entityKey",
  });

  return {
    coversExistingDocuments: covers,
    // Existence, not how many. One unreadable document is enough to make every
    // count a floor, and `truncated` on this read only means there are more of
    // them than the cap — which does not change the answer.
    anyUndetermined: markers.buckets.length > 0,
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
async function backfillFinished(
  backfill:
    | {
        scopes: () => Promise<readonly BackfillScope[]>;
        state: BackfillStateStore;
        unreachable: () => Promise<boolean>;
      }
    | undefined
): Promise<boolean> {
  if (backfill === undefined) return false;
  const [scopes, completed, unreachable] = await Promise.all([
    backfill.scopes(),
    backfill.state.completed(),
    backfill.unreachable(),
  ]);
  // Both, and neither implies the other. Every scope walked says the work this
  // index CAN do is done; unreachable content says there is content it cannot
  // do at all, and a site can be in either state independently.
  return backfillComplete(scopes, completed) && !unreachable;
}
