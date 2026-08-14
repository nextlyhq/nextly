/**
 * Pure drop-eligibility + insertion-index math for the canvas DnD (spec §9). Kept free of
 * React/@dnd-kit so it is unit-testable and reused by both the pointer and keyboard
 * sensors. `canDrop` enforces the structural invariants, from BOTH directions: only containers
 * accept children, a slot's `allowedBlocks` (when present) restricts the child types, and a
 * child's own `parent` (when present) restricts the containers it may sit under. The last two are
 * independent — neither is derivable from the other — and a block is only placeable where both
 * agree.
 */
import {
  isContainerType,
  isDeclaredHere,
  parentsOf,
  slotsOf,
} from "../../core/block-structure";
import type { BlockRegistry } from "../../core/registry";
import { slotAdmits } from "../../core/slot-allow";

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
  // Resolved from the definition first and structure otherwise, the same order the child's own
  // restriction is resolved in below. A block a PLUGIN contributed is registered with the engine
  // rather than with this package's registry, so asking only the registry would answer
  // "unknown-parent" for every contributed container — refusing a drop the block explicitly
  // declared it accepts, with a reason naming the wrong cause.
  const isContainer = isContainerType(parentType, registry);
  if (isContainer === undefined) return { ok: false, reason: "unknown-parent" };
  if (!isContainer) return { ok: false, reason: "not-a-container" };
  // Structure is enough to ENFORCE a rule and not enough to accept an insertion. A container only
  // the engine knows is drawn by `CanvasNode` as an unknown-block placeholder that renders no
  // slots at all — so a child authorized into it is written to the document and then vanishes from
  // the canvas, which is worse than refusing the drop. Enforcing where a block may NOT go and
  // granting where it may are different powers, and only the second needs a definition this
  // package can draw.
  if (!registry.get(parentType) && !isDeclaredHere(parentType)) {
    return { ok: false, reason: "unknown-parent" };
  }
  const slot = (slotsOf(parentType, registry) ?? []).find(
    s => s.name === slotName
  );
  if (!slot) return { ok: false, reason: "unknown-slot" };
  if (!slotAdmits(slot, childType)) {
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
