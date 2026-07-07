/**
 * Locate a node's position within the tree (spec §9). Pure + unit-tested so the inspector
 * reorder controls and the DnD drop handler agree on where a node lives. Returns the
 * parent id, the slot name, the child index, and the sibling count — everything a MOVE
 * dispatch needs — or null for the root / a missing id.
 */
import type { BlockNode } from "../../core/types";

export interface NodeLocation {
  parentId: string;
  slot: string;
  index: number;
  count: number;
}

export function locateNode(root: BlockNode, id: string): NodeLocation | null {
  const stack: BlockNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.slots) {
      for (const [slot, children] of Object.entries(node.slots)) {
        const index = children.findIndex(c => c.id === id);
        if (index !== -1) {
          return { parentId: node.id, slot, index, count: children.length };
        }
        stack.push(...children);
      }
    }
  }
  return null;
}
