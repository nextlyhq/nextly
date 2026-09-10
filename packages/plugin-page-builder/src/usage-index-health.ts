/**
 * How much of the usage index is actually there, asked ONCE for a whole screen.
 *
 * Two things make a usage count a floor, and neither is a property of the
 * component being counted:
 *
 * 1. A document that could not be walked whole is stored as a single marker
 *    with its references DISCARDED, so it is missing from every count rather
 *    than wrong in one of them.
 * 2. A scope that has never been backfilled contributes no rows at all, so
 *    every component used only there reads as used by nothing.
 *
 * Both answers are the same for every component in the library, which is why
 * they are asked here rather than inside the count. A component library screen
 * renders a tile per component and asks each one for a number; a per-component
 * marker query would issue the identical index-wide read once per tile, so a
 * hundred components would spend a hundred duplicate queries to learn one fact
 * - and spend them against the pool this index exists to keep free.
 *
 * ## Why this is not a cache
 *
 * It is read once and held for the render that asked. Nothing invalidates it,
 * because nothing needs to: the answer only ever moves from "a floor" towards
 * "whole", and a screen showing a caveat a few seconds after it stopped being
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
   * Whether every scope that exists now has been walked at least once.
   *
   * False on a site that upgraded into this index and has not finished
   * backfilling, and false again whenever a collection, a locale or a draft
   * variant is added, because those are scopes nothing has walked.
   */
  backfilled: boolean;
  /**
   * Whether any document in the index could not be read whole.
   *
   * Index-wide rather than per component, and that is the point: a marker
   * names no component, so "which unreadable documents reference this one" is
   * the question the marker exists because nothing can answer.
   */
  anyUndetermined: boolean;
}

/** Whether the index can answer for the whole population it claims to cover. */
export function indexIsWhole(health: UsageIndexHealth): boolean {
  return health.backfilled && !health.anyUndetermined;
}

/**
 * The health an installation with no backfill wiring should assume.
 *
 * Named rather than spelled inline at call sites, so the conservative answer is
 * one value with one docblock. `backfilled: false` is the SAFE direction: it
 * caveats every count, which is the reading that stops an author deleting a
 * component the index has no rows for yet.
 */
export const UNKNOWN_INDEX_HEALTH: UsageIndexHealth = {
  backfilled: false,
  anyUndetermined: false,
};

/**
 * Read the index-wide facts, in as few queries as they need.
 *
 * The marker probe is a grouped read exactly like a count, so it goes through
 * the same injected reader and needs no second capability.
 */
export async function readUsageIndexHealth<TRow extends UsageSubject>(args: {
  index: UsageIndex<TRow>;
  read: GroupedUsageReader;
  /** Every scope that exists now, from the current configuration. */
  scopes: readonly BackfillScope[];
  state: BackfillStateStore;
}): Promise<UsageIndexHealth> {
  const [completed, markers] = await Promise.all([
    args.state.completed(),
    args.read({
      where: args.index.whereUndetermined(),
      groupBy: "entityKey",
    }),
  ]);

  return {
    backfilled: backfillComplete(args.scopes, completed),
    // Existence, not how many. One unreadable document is enough to make every
    // count a floor, and `truncated` on this read only means there are more of
    // them than the cap - which does not change the answer.
    anyUndetermined: markers.bucketCount > 0,
  };
}
