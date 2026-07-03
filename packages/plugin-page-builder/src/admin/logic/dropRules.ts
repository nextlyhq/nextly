/**
 * Pure drop-eligibility + insertion-index math for the canvas DnD (spec §9). Kept free of
 * React/@dnd-kit so it is unit-testable and reused by both the pointer and keyboard
 * sensors. `canDrop` enforces the two structural invariants: only containers accept
 * children, and a slot's `allowedBlocks` (when present) restricts the child types.
 */
import type { BlockRegistry } from "../../core/registry";

export interface DropCheck {
  ok: boolean;
  reason?:
    | "unknown-parent"
    | "not-a-container"
    | "unknown-slot"
    | "not-allowed-in-slot";
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
