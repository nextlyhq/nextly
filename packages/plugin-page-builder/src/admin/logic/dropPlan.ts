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

import { canDrop } from "./dropRules";
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

export function planDrop(
  source: DragSource,
  target: DropTarget,
  root: BlockNode,
  registry: BlockRegistry
): DropAction | null {
  if (
    target.kind !== "dropzone" ||
    target.parentId == null ||
    target.slot == null
  ) {
    return null;
  }
  const parent = findNode(root, target.parentId);
  if (!parent) return null;
  const index = target.index ?? 0;

  if (source.kind === "library" && source.blockType) {
    if (!canDrop(parent.type, target.slot, source.blockType, registry).ok)
      return null;
    return {
      type: "ADD",
      parentId: target.parentId,
      slot: target.slot,
      nodeType: source.blockType,
      index,
    };
  }

  if (source.kind === "node" && source.nodeId) {
    const moving = findNode(root, source.nodeId);
    if (!moving) return null;
    // Cannot drop a node into itself or one of its descendants.
    if (findNode(moving, target.parentId)) return null;
    if (!canDrop(parent.type, target.slot, moving.type, registry).ok)
      return null;

    let toIndex = index;
    const loc = locateNode(root, source.nodeId);
    if (loc && loc.parentId === target.parentId && loc.slot === target.slot) {
      // Dropping into a gap adjacent to the source is a no-op.
      if (index === loc.index || index === loc.index + 1) return null;
      // Removing the source first shifts later gaps down by one.
      if (index > loc.index) toIndex = index - 1;
    }
    return {
      type: "MOVE",
      id: source.nodeId,
      parentId: target.parentId,
      slot: target.slot,
      index: toIndex,
    };
  }

  return null;
}
