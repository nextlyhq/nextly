/**
 * Pure drop planning for the canvas DnD (spec §9). Turns a drag source + a drop-zone
 * target into the exact editor action to dispatch — applying the drop rules, the cycle
 * guard, and the index adjustment a same-slot move needs (moveNode removes first, then
 * inserts, so a target index past the source shifts down by one). Kept React/@dnd-kit
 * free so the tricky index math is unit-tested.
 */
import type { BlockRegistry } from "../../core/registry";
import { findNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";

import { canDrop, type DropReason } from "./dropRules";
import { locateNode } from "./locate";

export interface DragSource {
  kind?: "library" | "node";
  blockType?: string;
  nodeId?: string;
}

export interface DropTarget {
  kind?: "dropzone";
  parentId?: string;
  slot?: string;
  /** Insert position: the dragged block becomes the `index`-th child (0..N). */
  index?: number;
}

export type DropAction =
  | {
      type: "ADD";
      parentId: string;
      slot: string;
      nodeType: string;
      index: number;
    }
  | { type: "MOVE"; id: string; parentId: string; slot: string; index: number };

/**
 * Why this planner refused a drop: every reason `canDrop` can give, plus the one only a MOVE can
 * hit.
 *
 * Derived from `DropReason` rather than restated, so a rule added to `canDrop` reaches the author
 * without a second list having to be remembered. `into-itself` is not among them because it is not
 * a property of the types involved — the same block type is a perfectly legal child of that
 * container; what refuses it is this particular node being an ancestor of that particular target.
 */
export type DropRefusal = DropReason | "into-itself";

/**
 * What a drag onto a target amounts to. Four outcomes, because there are four questions and
 * collapsing any two of them loses the one thing the canvas needs.
 *
 * `null` used to stand for three of these at once, at six separate sites — a refused drop, a drop
 * that changes nothing, and a target this planner could not identify. A caller could therefore
 * never tell a rejection from a no-op, so a refusal had nowhere to put its reason and the canvas
 * had nothing to draw: the author released into dead space and the editor said nothing.
 */
export type DropOutcome =
  /** Dispatch it. */
  | { kind: "action"; action: DropAction }
  /** A rule says no, and says which. The author is owed this one. */
  | { kind: "refused"; reason: DropRefusal }
  /** A legal drop that would leave the tree exactly as it is. Nothing to do, nothing to explain. */
  | { kind: "unchanged" }
  /** No source or target this planner can resolve — not a drop attempt it has an opinion about. */
  | { kind: "unresolved" };

export function planDrop(
  source: DragSource,
  target: DropTarget,
  root: BlockNode,
  registry: BlockRegistry
): DropOutcome {
  if (
    target.kind !== "dropzone" ||
    target.parentId == null ||
    target.slot == null
  ) {
    return { kind: "unresolved" };
  }
  const parent = findNode(root, target.parentId);
  // The zone names a node the document does not hold, so there is no place to judge rather than a
  // place that refuses. Telling the author a rule stopped them would name a cause that does not
  // exist.
  if (!parent) return { kind: "unresolved" };
  const index = target.index ?? 0;

  if (source.kind === "library" && source.blockType) {
    const check = canDrop(parent.type, target.slot, source.blockType, registry);
    if (!check.ok) return { kind: "refused", reason: check.reason };
    return {
      kind: "action",
      action: {
        type: "ADD",
        parentId: target.parentId,
        slot: target.slot,
        nodeType: source.blockType,
        index,
      },
    };
  }

  if (source.kind === "node" && source.nodeId) {
    const moving = findNode(root, source.nodeId);
    if (!moving) return { kind: "unresolved" };
    // Cannot drop a node into itself or one of its descendants. A refusal rather than a no-op: the
    // author aimed at somewhere real and a rule stopped them, which is exactly the case that has
    // to say so.
    if (findNode(moving, target.parentId))
      return { kind: "refused", reason: "into-itself" };
    const check = canDrop(parent.type, target.slot, moving.type, registry);
    if (!check.ok) return { kind: "refused", reason: check.reason };

    let toIndex = index;
    const loc = locateNode(root, source.nodeId);
    if (loc && loc.parentId === target.parentId && loc.slot === target.slot) {
      // Dropping into a gap adjacent to the source is a no-op. Distinct from a refusal: the drop
      // is allowed and simply lands where the block already is, so drawing a refusal here would
      // tell the author a legal move is forbidden.
      if (index === loc.index || index === loc.index + 1)
        return { kind: "unchanged" };
      // Removing the source first shifts later gaps down by one.
      if (index > loc.index) toIndex = index - 1;
    }
    return {
      kind: "action",
      action: {
        type: "MOVE",
        id: source.nodeId,
        parentId: target.parentId,
        slot: target.slot,
        index: toIndex,
      },
    };
  }

  return { kind: "unresolved" };
}
