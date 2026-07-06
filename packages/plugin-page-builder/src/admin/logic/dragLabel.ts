/**
 * Resolve the human label for a drag source (spec §9). A library source knows its block
 * type directly; a node source only carries its id, so we look the node up in the current
 * document and read its definition's label. Pure → unit-tested.
 */
import type { BlockRegistry } from "../../core/registry";
import { findNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";

import type { DragSource } from "./dropPlan";

export function dragLabel(
  data: DragSource,
  root: BlockNode,
  registry: BlockRegistry
): string {
  if (data.kind === "library" && data.blockType) {
    return registry.get(data.blockType)?.label ?? data.blockType;
  }
  if (data.kind === "node" && data.nodeId) {
    const node = findNode(root, data.nodeId);
    const label = node ? registry.get(node.type)?.label : undefined;
    return label ?? "Block";
  }
  return "Block";
}
