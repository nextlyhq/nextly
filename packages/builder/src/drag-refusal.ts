/**
 * The words an author reads when a region will not take the block they hold.
 *
 * Separated from the engine deliberately, and by the engine's own instruction:
 * {@link drop-targets} produces a refusal CODE plus the list of what the region
 * accepts, because "wording is a presentation decision — it belongs where the
 * words are drawn and where they can be translated — and a code is what a
 * caller can branch on". This module is that caller.
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
import type { DropRefusal } from "./drop-targets";
import { blockLabel } from "./inserter";

/** The two lines a refusal draws. */
export interface RefusalWording {
  /** Why the drop will not happen, in one sentence. */
  readonly headline: string;
  /**
   * What the region does take, or null when the engine named nothing.
   *
   * Null rather than an empty string: a caller rendering it unconditionally
   * would draw "Takes" with nothing after it, which reads as a sentence that
   * was cut off rather than as an absent fact.
   */
  readonly takes: string | null;
}

/**
 * "a" or "an", decided by the LABEL rather than by the type it came from.
 *
 * The label is what appears in the sentence, so it is what the article has to
 * agree with. Deciding from the type would ask about "core/image", which begins
 * with a consonant, and produce "a Image".
 *
 * Spelling rather than pronunciation, which is the honest bound: this is right
 * for the vowel-initial labels a block palette actually produces and would be
 * wrong for an initialism read letter by letter. A pronunciation dictionary is
 * not worth carrying for a set of names the project chooses itself.
 */
function article(label: string): string {
  return /^[aeiou]/i.test(label) ? "an" : "a";
}

/**
 * The permitted types as prose.
 *
 * A sentence an author reads rather than a set they scan, so it takes "and"
 * rather than a delimiter. Two members join without a comma; three or more take
 * commas up to the last.
 */
function asList(labels: readonly string[]): string {
  if (labels.length === 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  const last = labels[labels.length - 1];
  return `${labels.slice(0, -1).join(", ")} and ${last}`;
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
  refusal: DropRefusal,
  movingType: string,
  regionType: string | undefined
): RefusalWording {
  const moving = blockLabel(movingType);
  const region = regionType === undefined ? undefined : blockLabel(regionType);
  const moved = `${article(moving)} ${moving}`;

  const headline = ((): string => {
    switch (refusal.reason) {
      case "restricted-at-root":
        // Not "choose another container": there is none on screen that would
        // take it, so the only remedy is to create the nesting.
        return `${moving} has to sit inside a container.`;
      case "not-allowed-in-slot":
        // The slot refuses, not the block's parent — naming the parent here
        // would send the author to change the wrong thing.
        return `This slot does not take ${moved}.`;
      case "wrong-parent":
        return region === undefined
          ? `That container does not take ${moved}.`
          : `${region} does not take ${moved}.`;
    }
  })();

  const permitted = refusal.permitted.map(blockLabel);
  return {
    headline,
    takes: permitted.length === 0 ? null : `Takes ${asList(permitted)}`,
  };
}
