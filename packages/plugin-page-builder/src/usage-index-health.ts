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
}): Promise<UsageIndexHealth> {
  const markers = await args.read({
    where: args.index.whereUndetermined(),
    groupBy: "entityKey",
  });

  return {
    // Nothing backfills the index yet, so no reading of the database can make
    // this true. Stated as a constant HERE rather than left for each caller to
    // remember, so the day a backfill lands there is one place that learns to
    // ask it.
    coversExistingDocuments: false,
    // Existence, not how many. One unreadable document is enough to make every
    // count a floor, and `truncated` on this read only means there are more of
    // them than the cap — which does not change the answer.
    anyUndetermined: markers.bucketCount > 0,
  };
}
