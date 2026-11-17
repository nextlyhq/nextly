/**
 * The words an author reads when a region will not take the block they hold.
 *
 * {@link drop-targets} produces a refusal CODE plus the list of what the region
 * accepts. The sentences themselves are the engine's
 * (`placementRefusalWording`), because the server words the same refusals on a
 * save and an author must read the same words from both; this module binds
 * them to the editor's block labels.
 *
 * ## Three reasons, three remedies
 *
 * The reasons are not three spellings of "no". `wrong-parent` means aim at a
 * different container; `restricted-at-root` means put the block inside
 * something, because at the root there is no container on screen that would
 * satisfy it; `not-allowed-in-slot` means this particular slot, not the block's
 * parent. {@link nesting} keeps them distinct for exactly this reason, and a
 * single sentence covering all three would answer the second with advice that
 * cannot be followed.
 *
 * ## Naming what the region DOES take
 *
 * `permitted` is what turns a refusal into an instruction. A message that only
 * says no leaves the author to discover the rule by trying containers one at a
 * time; one that names the accepted types answers the next question before it
 * is asked.
 *
 * ## Pure, and tested without a DOM
 *
 * Every sentence is a function of the refusal and two block types, so whether
 * the wording is RIGHT for a given reason is checkable without rendering
 * anything — which is the half most likely to be wrong.
 *
 * @module drag-refusal
 */
import {
  placementRefusalWording,
  type NestingRefusal,
  type PlacementRefused,
} from "@nextlyhq/blocks-engine";

import type { DropRefusal } from "./drop-targets";
import { blockLabel } from "./inserter";

/**
 * The two facts a refusal's wording is built from.
 *
 * Narrower than {@link DropRefusal} on purpose. A drop carries a region id and
 * a parent id because the canvas needs them to draw the refusal in place; the
 * WORDS need only the reason and what the rule permits. Taking the pair rather
 * than the whole lets a caller that never had a region — a keyboard move, which
 * has a position and no pointer — reuse these sentences instead of inventing a
 * second vocabulary, without fabricating a region id to satisfy a type.
 */
export type RefusalFacts = Pick<
  DropRefusal,
  "reason" | "permitted" | "verdict"
>;

/** The two lines a refusal draws. */
export interface RefusalWording {
  /** Why the drop will not happen, in one sentence. */
  readonly headline: string;
  /**
   * What the author can do about it, or null when the engine named nothing.
   *
   * Named for the job rather than for one of its sentences, because
   * `permitted` does NOT mean the same thing for every reason and the wording
   * has to follow that. A slot refusal names what the SLOT admits; the other
   * two name the containers the MOVING BLOCK is allowed to sit inside. Calling
   * both "This spot takes" asserts something about the region that the second
   * kind never said — it would read as the accordion accepting columns, which
   * is not what was measured; those say where the block goes instead.
   *
   * Null rather than an empty string: a caller rendering it unconditionally
   * would draw a sentence that was cut off rather than an absent fact.
   */
  readonly remedy: string | null;
}

/**
 * Why this drop will not happen, and what would.
 *
 * `regionType` is optional because one reason has no region to name —
 * `restricted-at-root` is a block sitting where there is no parent at all — and
 * because the caller resolves the region from the document by id, which can
 * legitimately come up empty while the refusal itself is sound. Both cases get
 * a sentence rather than a gap where a name should be.
 */
export function refusalWording(
  refusal: RefusalFacts,
  movingType: string,
  regionType: string | undefined
): RefusalWording {
  // The rule's whole answer, when the drop was judged by it.
  if (refusal.verdict !== undefined) {
    return placementWording(refusal.verdict, movingType, regionType);
  }
  return placementRefusalWording(
    {
      allowed: false,
      reason: refusal.reason as NestingRefusal,
      blockType: movingType,
      permitted: refusal.permitted,
    },
    {
      labelOf: blockLabel,
      ...(regionType === undefined ? {} : { regionType }),
    }
  );
}

/**
 * Why a placement the one rule refused will not happen, for any reason it
 * gives: a slot the container does not declare, a block that holds none, or
 * HTML's content model, as well as the name rules. Named for the block the
 * author moved; when the rule refused something inside it, both are named.
 */
export function placementWording(
  verdict: PlacementRefused,
  movingType: string,
  regionType: string | undefined
): RefusalWording {
  return placementRefusalWording(verdict, {
    labelOf: blockLabel,
    movingType,
    ...(regionType === undefined ? {} : { regionType }),
  });
}
