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
  parentsOf,
  slotsOf,
} from "../../core/block-structure";
import type { BlockRegistry } from "../../core/registry";
import { slotAdmits } from "../../core/slot-allow";
import type { BlockNode } from "../../core/types";

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
 * Whether every parent/child relation INSIDE this subtree is one `canDrop` would allow.
 *
 * `canDrop` judges one placement: this block, into that slot. That is the whole question for a
 * block being created, because a fresh node has no children — and it is not the whole question for
 * a subtree arriving from somewhere else. A container copied from a page written before its slot
 * gained an allowlist, or by a plugin that has since narrowed one, carries relations that were
 * legal when they were made; checking only its root type admits the entire tree on the strength of
 * its outermost block, and the destination is then unsaveable for a fault several levels down that
 * the author never chose and did not author.
 *
 * Deliberately independent of where the subtree is going. Its INTERNAL relations are the same
 * wherever it lands, so the caller pairs this with the placement check for the root rather than
 * this repeating it.
 *
 * Depth and node limits are NOT judged here. Both depend on the destination rather than on the
 * subtree, and `validate` reports either with a message naming the limit — where a slot violation
 * inside a pasted tree is the one fault that draws normally and explains nothing.
 */
export function subtreeIsPlaceable(
  node: BlockNode,
  registry: BlockRegistry
): boolean {
  for (const [slotName, children] of Object.entries(node.slots ?? {})) {
    for (const child of children) {
      if (!canDrop(node.type, slotName, child.type, registry).ok) return false;
      if (!subtreeIsPlaceable(child, registry)) return false;
    }
  }
  return true;
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
