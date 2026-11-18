/**
 * Wrapping selected blocks in a Box, and unwrapping a container while keeping
 * what is inside it.
 *
 * Both are groups of the ordinary ops, applied together as ONE step to undo:
 *
 * - **Wrap in a box.** The selected blocks must sit side by side in one list
 *   (the engine's `siblingRun`, the rule every selection planner shares). A new
 *   Box is put where the first of them is, and each is moved into it in the
 *   order a reader meets them.
 * - **Unwrap (keep what's inside).** A Box, Section, Column or Card is replaced
 *   by its blocks, in order, at its own place, and removed.
 *
 * Each result is judged by the engine's one placement rule
 * (`placementVerdict`) before anything is planned: a Box where it would land,
 * the wrapped blocks inside a Box, and an unwrapped container's blocks where
 * the container was. A refusal says why in the words a refused drop uses, so
 * a Column is never left outside Columns.
 *
 * @module selection-wrap
 */
import {
  findNode,
  getBlock,
  locateNode,
  makeNode,
  placementVerdict,
  siblingRun,
  type BlockDocument,
  type BlockNode,
  type NestingSource,
  type PlacementTarget,
} from "@nextlyhq/blocks-engine";

import { placementWording } from "./canvas/drag-refusal";
import type { BuilderOp } from "./op-vocabulary";
import { normalizeSelection } from "./selection";
import type { SelectionRefusal } from "./selection-ops";

/** The block a wrap puts the selection into. */
const BOX = "core/box";

/** The slot a container holds its blocks in. */
const CHILDREN = "children";

/** The containers that can be unwrapped, keeping their blocks. */
const UNWRAPPABLE: ReadonlySet<string> = new Set([
  "core/box",
  "core/section",
  "core/column",
  "core/card",
]);

/** The verbs' words, in one place. */
export const WRAP_WORDS = {
  wrap: "Wrap in a box",
  unwrap: "Unwrap (keep what's inside)",
  notSideBySide: "Select blocks side by side in one place to wrap them in a box.",
} as const;

/** A wrap or an unwrap, planned: its ops and what to select after it. */
export interface WrapPlan {
  readonly ops: readonly BuilderOp[];
  /** What to select once it lands: the new Box, or the unwrapped blocks. */
  readonly select: readonly string[];
}

/** Where a node's list is, as a placement target. */
function targetOf(
  parent: BlockNode | undefined,
  slot: string | undefined
): PlacementTarget {
  return parent === undefined || slot === undefined
    ? { kind: "root" }
    : { kind: "slot", parentType: parent.type, slot };
}

/** The refusal for `types` at `where`, in a refused drop's words, if any. */
function placementRefusal(
  types: readonly string[],
  where: PlacementTarget,
  nesting: NestingSource
): SelectionRefusal | null {
  const verdict = placementVerdict(types, where, nesting);
  if (verdict.allowed) return null;
  return {
    reason: placementWording(
      verdict,
      verdict.blockType,
      where.kind === "slot" ? where.parentType : undefined
    ).headline,
  };
}

/**
 * Wrapping the selection in a new Box at its place. `null` for nothing
 * selected or no Box block in this editor; a refusal when the blocks are not
 * side by side or the placement rules forbid the result.
 */
export function planWrap(
  document: BlockDocument,
  selectedIds: readonly string[],
  nesting: NestingSource
): WrapPlan | SelectionRefusal | null {
  const ids = normalizeSelection(document, selectedIds);
  const box = getBlock(BOX);
  if (ids.length === 0 || box === undefined) return null;
  const found = siblingRun(document.nodes, ids);
  if (found.run === undefined) return { reason: WRAP_WORDS.notSideBySide };
  const { run } = found;
  const parent =
    run.parentId === undefined
      ? undefined
      : findNode(document.nodes, run.parentId);
  const refused =
    placementRefusal([BOX], targetOf(parent, run.slot), nesting) ??
    placementRefusal(
      run.places.map(place => place.node.type),
      { kind: "slot", parentType: BOX, slot: CHILDREN },
      nesting
    );
  if (refused !== null) return refused;
  const first = run.places[0];
  if (first === undefined) return null;
  const wrapper = makeNode(
    box.name,
    box.version,
    structuredClone((box.defaultProps ?? {}) as Record<string, unknown>),
    { [CHILDREN]: [] }
  );
  const at =
    run.parentId === undefined || run.slot === undefined
      ? { index: first.index }
      : { parentId: run.parentId, slot: run.slot, index: first.index };
  return {
    ops: [
      { kind: "insert", node: wrapper, at },
      ...run.places.map(
        (place, index): BuilderOp => ({
          kind: "move",
          id: place.id,
          to: { parentId: wrapper.id, slot: CHILDREN, index },
        })
      ),
    ],
    select: [wrapper.id],
  };
}

/** Whether a block can be unwrapped, keeping what is inside it. */
export function isUnwrappable(node: BlockNode | undefined): boolean {
  return node !== undefined && UNWRAPPABLE.has(node.type);
}

/**
 * Unwrapping one container: its blocks moved to its place, in order, and the
 * container removed. `null` for a block that is not a container one can
 * unwrap; a refusal when its blocks may not sit where it was.
 */
export function planUnwrap(
  document: BlockDocument,
  id: string,
  nesting: NestingSource
): WrapPlan | SelectionRefusal | null {
  const node = findNode(document.nodes, id);
  if (node === undefined || !isUnwrappable(node)) return null;
  const location = locateNode(document.nodes, id);
  if (location === undefined) return null;
  const children = node.slots?.[CHILDREN] ?? [];
  const refused = placementRefusal(
    children.map(child => child.type),
    targetOf(location.parent, location.slot),
    nesting
  );
  if (refused !== null) return refused;
  const placeAt = (index: number) =>
    location.parent === undefined || location.slot === undefined
      ? { index }
      : { parentId: location.parent.id, slot: location.slot, index };
  return {
    ops: [
      // Each before the container, in order: the container shifts right as
      // they arrive, so the next index is always the one after the last.
      ...children.map(
        (child, offset): BuilderOp => ({
          kind: "move",
          id: child.id,
          to: placeAt(location.index + offset),
        })
      ),
      { kind: "remove", id },
    ],
    select: children.map(child => child.id),
  };
}
