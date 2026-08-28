/**
 * The vocabulary a read and the releases repository share.
 *
 * A leaf module on purpose. The repository needs to know whose membership a
 * read is asking about, and the read seam needs to know the shape of the answer
 * — putting either type in the other's module makes the two import each other,
 * and this repository already carries more import cycles than it wants.
 *
 * @module domains/releases/release-scope
 */

/**
 * What a due release does to the documents in one scope.
 *
 * Two directions, not one. A release both publishes and withdraws, and a seam
 * that carried only the publish half made every scheduled takedown a silent
 * no-op — the decision was computed, then thrown away.
 *
 * The two sets are DISJOINT: `resolveReleaseEffect` picks a single winning
 * member per document, so no id can appear in both.
 */
export interface ReleaseDecisions {
  /** Documents a due release makes visible to a published read. */
  reveal: readonly string[];
  /** Documents a due release withdraws from a published read. */
  hide: readonly string[];
}

/** Nothing is due. Shared so the common answer allocates nothing. */
export const NO_DECISIONS: ReleaseDecisions = { reveal: [], hide: [] };
