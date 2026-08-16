/**
 * Pure drop-eligibility + insertion-index math for the canvas DnD (spec §9). Kept free of
 * React/@dnd-kit so it is unit-testable and reused by both the pointer and keyboard
 * sensors. `canDrop` enforces the structural invariants, from BOTH directions: only containers
 * accept children, a slot's `allowedBlocks` (when present) restricts the child types, and a
 * child's own `parent` (when present) restricts the containers it may sit under. The last two are
 * independent — neither is derivable from the other — and a block is only placeable where both
 * agree.
 */
import { canNest, type NestingRefusal } from "@nextlyhq/blocks-engine";

import {
  isContainerType,
  isDeclaredHere,
  parentsOf,
  slotsOf,
} from "../../core/block-structure";
import type { BlockRegistry } from "../../core/registry";
import { slotAdmits } from "../../core/slot-allow";

/**
 * Which rule refused a drop.
 *
 * Named rather than inlined because the reason travels: the canvas has to tell the author WHICH
 * rule stopped the drop, and a caller that only reads `ok` throws that away at the one point where
 * it is still known.
 */
export type DropReason =
  | "unknown-parent"
  | "not-a-container"
  | "unknown-slot"
  | "not-allowed-in-slot"
  /** The CHILD restricts which parents it may sit under, and this is not one. */
  | "wrong-parent";

/**
 * A refusal carries its reason by construction.
 *
 * As two members rather than one shape with an optional field, because an optional `reason` makes
 * `{ ok: false }` on its own type-check: a refusal with nothing to say about itself becomes
 * expressible, and every caller wanting the reason has to handle an absence no code path produces.
 *
 * `reason?: undefined` on the accepting member keeps `canDrop(...).reason` readable without first
 * narrowing on `ok` — the reason is `undefined` there because an accepted drop has none.
 */
export type DropCheck =
  | { ok: true; reason?: undefined }
  | { ok: false; reason: DropReason };

/**
 * The editor's word for each refusal the nesting rule can produce.
 *
 * A total `Record` rather than a narrowing check, because the two vocabularies are allowed to
 * diverge and only this table may decide how. Narrowing on the one reason `canNest` produces today
 * would fail OPEN the moment the engine adds another — the drop would simply be permitted — while
 * an exhaustive map stops compiling until somebody chooses the editor's word for it.
 *
 * `restricted-at-root` maps to the same reason rather than gaining one of its own, and that is a
 * judgement about the SENTENCE rather than about the rule. "This block can only go inside certain
 * containers" is exactly what an author needs to hear about a block that restricts its parents and
 * is sitting where there are none. `canNest` cannot return it — only `canBeRoot` can, and nothing
 * here calls that — so this arm is unreachable today and costs nothing while it stays so.
 */
const NESTING_REASONS: Record<NestingRefusal, DropReason> = {
  "wrong-parent": "wrong-parent",
  "restricted-at-root": "wrong-parent",
};

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
  // anything still may not be a home for a block that only means something under one parent.
  //
  // ASKED of the engine rather than answered here. The same rule decides whether a stored document
  // is valid and whether a drag may land, and two implementations of it agree on the day they are
  // written — so this calls `canNest` rather than re-reading `parentsOf` itself. What stays here is
  // the editor's own concern: which RESOLVER the rule reads through, since this package resolves a
  // definition first and falls back to declared structure so a plugin-contributed block is not
  // reported as unrestricted.
  const verdict = canNest(childType, parentType, {
    parentsOf: type => parentsOf(type, registry),
  });
  if (!verdict.allowed) {
    return { ok: false, reason: NESTING_REASONS[verdict.reason] };
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
