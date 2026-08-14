/**
 * Pure drop-eligibility + insertion-index math for the canvas DnD (spec §9). Kept free of
 * React/@dnd-kit so it is unit-testable and reused by both the pointer and keyboard
 * sensors. `canDrop` enforces the structural invariants, from BOTH directions: only containers
 * accept children, a slot's `allowedBlocks` (when present) restricts the child types, and a
 * child's own `parent` (when present) restricts the containers it may sit under. The last two are
 * independent — neither is derivable from the other — and a block is only placeable where both
 * agree.
 */
import { parentsOf } from "../../core/block-structure";
import type { BlockRegistry } from "../../core/registry";

export interface DropCheck {
  ok: boolean;
  reason?:
    | "unknown-parent"
    | "not-a-container"
    | "unknown-slot"
    | "not-allowed-in-slot"
    /** The CHILD restricts which parents it may sit under, and this is not one. */
    | "wrong-parent";
}

export function canDrop(
  parentType: string,
  slotName: string,
  childType: string,
  registry: BlockRegistry
): DropCheck {
  const parent = registry.get(parentType);
  if (!parent) return { ok: false, reason: "unknown-parent" };
  if (!parent.isContainer) return { ok: false, reason: "not-a-container" };
  const slot = (parent.slots ?? []).find(s => s.name === slotName);
  if (!slot) return { ok: false, reason: "unknown-slot" };
  if (slot.allowedBlocks && !slot.allowedBlocks.includes(childType)) {
    return { ok: false, reason: "not-allowed-in-slot" };
  }
  // The child's own restriction, which the parent's allowlist cannot express. A slot that takes
  // anything still may not be a home for a block that only means something under one parent, and
  // asking here rather than at each caller is what makes drag, Insert, paste and reorder agree.
  const parents = parentsOf(childType, registry);
  if (parents && !parents.includes(parentType)) {
    return { ok: false, reason: "wrong-parent" };
  }
  return { ok: true };
}

/**
 * Index at which a dragged block should be inserted, given the sibling rects (in
 * document/pointer space) and the pointer's Y. Inserts before the first sibling whose
 * vertical midpoint is below the pointer; appends when the pointer is past all of them.
 */
export function insertionIndex(
  rects: { top: number; height: number }[],
  pointerY: number
): number {
  for (let i = 0; i < rects.length; i++) {
    const mid = rects[i].top + rects[i].height / 2;
    if (pointerY < mid) return i;
  }
  return rects.length;
}
