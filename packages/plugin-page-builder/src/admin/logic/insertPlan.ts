/**
 * Where a block goes when it is INSERTED rather than dragged (spec §9).
 *
 * The library offers two ways to add a block and they arrive at the canvas by different routes: a
 * drag ends on a drop zone, which names its own parent and slot, while Insert has only the
 * selection to go on and has to find a home. `planDrop` answers the first and this answers the
 * second.
 *
 * Both ask `canDrop`, and neither ENFORCES it. Paste and keyboard reorder reach the store without
 * planning anything, so the allowlist is enforced in the reducer, which every insertion passes
 * through. What this adds is the choice of a target the author will like — the nearest place that
 * accepts the block — rather than a refusal.
 *
 * Kept React- and @dnd-kit-free so the walk can be unit-tested.
 */
import { declaredSlotsOf } from "../../core/block-structure";
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
 * "Place" is a container AND one of its slots: a container may hold its children under any name,
 * so which slot accepts the block is part of the answer rather than an assumption.
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
    const slot = acceptingSlotOf(candidate, blockType, registry);
    if (slot) {
      const count = candidate.slots?.[slot]?.length ?? 0;
      return {
        parentId: candidate.id,
        slot,
        // A position is only carried into the SAME slot it came from; anywhere else it names a
        // place among children it was never among.
        index:
          after !== null && slot === DEFAULT_SLOT
            ? Math.min(after + 1, count)
            : count,
      };
    }
    const location = locateNode(root, candidate.id);
    if (!location) return null;
    const parent = findNode(root, location.parentId);
    if (!parent) return null;
    after = location.slot === DEFAULT_SLOT ? location.index : null;
    candidate = parent;
  }
}

/**
 * The slot on this container that will take `blockType`, or `undefined` for none.
 *
 * Every slot the definition declares is asked, in declaration order, rather than only `default`.
 * A container is free to hold its children under any name — `sidebar`, `items` — and the drag path
 * offers a drop zone for each of them, so an Insert button that asked about one name would refuse
 * a container the very same block can be dropped into.
 *
 * Declaration order rather than a preference: it is the order the block author wrote, which is the
 * only statement of intent available, and it puts `default` first wherever a container declares
 * one alongside others.
 */
function acceptingSlotOf(
  container: BlockNode,
  blockType: string,
  registry: BlockRegistry
): string | undefined {
  const def = registry.get(container.type);
  const slots = def ? def.slots : declaredSlotsOf(container.type);
  return (slots ?? []).find(
    spec => canDrop(container.type, spec.name, blockType, registry).ok
  )?.name;
}
