/**
 * Where a block goes when it is INSERTED rather than dragged (spec §9).
 *
 * The library offers two ways to add a block and they arrive at the canvas by different routes: a
 * drag ends on a drop zone, which names its own parent and slot, while Insert has only the
 * selection to go on and has to find a home. `planDrop` answers the first, this answers the second,
 * and both ask `canDrop` — so a slot's allowlist is enforced whichever way a block is added, rather
 * than on the path whoever wrote the rule happened to be looking at.
 *
 * Kept React- and @dnd-kit-free so the walk can be unit-tested.
 */
import type { BlockRegistry } from "../../core/registry";
import { findNode } from "../../core/tree";
import { DEFAULT_SLOT, type BlockNode } from "../../core/types";

import { canDrop } from "./dropRules";
import { locateNode } from "./locate";

export interface InsertTarget {
  parentId: string;
  slot: string;
  /** The new block becomes the `index`-th child of that slot. */
  index: number;
}

/**
 * The nearest place the selection can reach that will take this block, or `null` when nowhere will.
 *
 * The search runs OUTWARD from the selection — the selected container first, then each ancestor,
 * then the page root — because that is the order of least surprise: a block lands as close to what
 * the author is looking at as the structure permits. A row that only takes columns therefore passes
 * an ordinary block up to whatever holds the row, instead of refusing it.
 *
 * `null` is a real answer rather than a fallback to the root. The root has an allowlist like any
 * other slot, and inserting somewhere the author cannot see because the obvious place refused is
 * worse than saying it cannot be done.
 */
export function planInsert(
  root: BlockNode,
  selectedId: string | undefined,
  blockType: string,
  registry: BlockRegistry
): InsertTarget | null {
  const selected = selectedId ? findNode(root, selectedId) : undefined;
  let candidate = selected ?? root;
  // Where the branch we came from sits, so an ancestor takes the block directly after the subtree
  // the author was working in rather than at the far end of the page.
  let after: number | null = null;

  for (;;) {
    if (canDrop(candidate.type, DEFAULT_SLOT, blockType, registry).ok) {
      const count = candidate.slots?.[DEFAULT_SLOT]?.length ?? 0;
      return {
        parentId: candidate.id,
        slot: DEFAULT_SLOT,
        index: after === null ? count : Math.min(after + 1, count),
      };
    }
    const location = locateNode(root, candidate.id);
    if (!location) return null;
    const parent = findNode(root, location.parentId);
    if (!parent) return null;
    // Only a position within the SAME slot can be carried upward; a block that came out of a named
    // slot has no meaningful index in the default one.
    after = location.slot === DEFAULT_SLOT ? location.index : null;
    candidate = parent;
  }
}
