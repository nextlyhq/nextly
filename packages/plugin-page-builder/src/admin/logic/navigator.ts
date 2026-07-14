/** Flatten the block tree into a depth-tagged list for the Navigator (layers) panel. */
import type { BlockNode } from "../../core/types";

export interface NavRow {
  id: string;
  type: string;
  depth: number;
  name?: string;
  locked?: boolean;
}

export function flattenTree(root: BlockNode): NavRow[] {
  const out: NavRow[] = [];
  const walk = (n: BlockNode, depth: number) => {
    out.push({ id: n.id, type: n.type, depth, name: n.name, locked: n.locked });
    if (n.slots) {
      for (const kids of Object.values(n.slots)) {
        for (const k of kids) walk(k, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}
