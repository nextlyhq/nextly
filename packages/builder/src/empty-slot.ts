/**
 * Which of a block's declared regions is empty.
 *
 * Asked by two callers that must agree: the inserter, deciding whether a new
 * block goes INSIDE the selection or beside it, and the canvas appender,
 * deciding where to draw a "+". A second copy of this would agree on the day
 * it was written and drift afterwards, and the drift would be silent because
 * an appender offering to fill a container the inserter then fills elsewhere
 * looks correct from both sides.
 *
 * @module empty-slot
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";

import type { SlotSource } from "./inserter";

/**
 * The block's first declared slot, when it holds nothing.
 *
 * FIRST rather than any: a block with several regions has an order, and the
 * one an author means by "inside this" is the one it declares first. Answering
 * with some other empty region would put content where nobody pointed.
 *
 * @param node - the node to inspect
 * @param slots - what each block type declares; absent means nothing is known
 * @returns the slot's name, or `null` when this is not an empty container
 */
export function emptySlotOf(
  node: BlockNode,
  slots: SlotSource | undefined
): string | null {
  const declared = slots?.slotsOf(node.type);
  const first = declared?.[0];
  if (first === undefined) return null;
  return (node.slots?.[first]?.length ?? 0) === 0 ? first : null;
}
