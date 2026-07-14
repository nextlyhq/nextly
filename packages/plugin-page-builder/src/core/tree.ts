/**
 * Slot-aware, immutable operations over the block tree (spec §5/§6). Pure and
 * React-free. Every mutation returns a new tree; the input is never modified.
 */
import type { BlockNode, ResponsiveStyle } from "./types";
import { DEFAULT_SLOT } from "./types";

/** Stable unique id. `crypto.randomUUID` is available in Node ≥18 and modern browsers. */
export function newId(): string {
  return `pb-${crypto.randomUUID()}`;
}

export function makeNode(
  type: string,
  props: Record<string, unknown> = {},
  style?: ResponsiveStyle,
  slots?: Record<string, BlockNode[]>
): BlockNode {
  const node: BlockNode = { id: newId(), type, props };
  if (style) node.style = style;
  if (slots) node.slots = slots;
  return node;
}

/** Depth-first visit: the node, then each slot's children in order. */
export function walk(
  node: BlockNode,
  fn: (n: BlockNode, parent?: BlockNode) => void,
  parent?: BlockNode
): void {
  fn(node, parent);
  if (!node.slots) return;
  for (const children of Object.values(node.slots)) {
    for (const child of children) walk(child, fn, node);
  }
}

export function findNode(node: BlockNode, id: string): BlockNode | undefined {
  if (node.id === id) return node;
  if (!node.slots) return undefined;
  for (const children of Object.values(node.slots)) {
    for (const child of children) {
      const hit = findNode(child, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Immutably rebuild the tree, applying `fn` to every node (parents before children). */
function mapTree(node: BlockNode, fn: (n: BlockNode) => BlockNode): BlockNode {
  const mapped = fn(node);
  if (!mapped.slots) return mapped;
  const slots: Record<string, BlockNode[]> = {};
  for (const [name, children] of Object.entries(mapped.slots)) {
    slots[name] = children.map(c => mapTree(c, fn));
  }
  return { ...mapped, slots };
}

export function insertNode(
  root: BlockNode,
  parentId: string,
  slot: string,
  node: BlockNode,
  index: number
): BlockNode {
  return mapTree(root, n => {
    if (n.id !== parentId) return n;
    const slots = { ...(n.slots ?? {}) };
    const children = [...(slots[slot] ?? [])];
    children.splice(Math.max(0, Math.min(index, children.length)), 0, node);
    slots[slot] = children;
    return { ...n, slots };
  });
}

export function removeNode(root: BlockNode, id: string): BlockNode {
  return mapTree(root, n => {
    if (!n.slots) return n;
    const slots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(n.slots)) {
      slots[name] = children.filter(c => c.id !== id);
    }
    return { ...n, slots };
  });
}

/** True if `id` is `ancestorId` itself or nested anywhere inside it. */
function isSelfOrDescendant(
  root: BlockNode,
  ancestorId: string,
  id: string
): boolean {
  const ancestor = findNode(root, ancestorId);
  return !!ancestor && !!findNode(ancestor, id);
}

export function moveNode(
  root: BlockNode,
  id: string,
  parentId: string,
  slot: string,
  index: number
): BlockNode {
  if (id === parentId || isSelfOrDescendant(root, id, parentId)) return root; // cycle guard
  const found = findNode(root, id);
  if (!found) return root;
  const without = removeNode(root, id);
  return insertNode(without, parentId, slot, found, index);
}

/** Deep-clone a subtree, assigning fresh ids to every node (for copy/paste + patterns). */
export function reidSubtree(n: BlockNode): BlockNode {
  const copy: BlockNode = { ...structuredClone(n), id: newId() };
  if (n.slots) {
    const slots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(n.slots)) {
      slots[name] = children.map(reidSubtree);
    }
    copy.slots = slots;
  }
  return copy;
}

export function duplicateNode(root: BlockNode, id: string): BlockNode {
  const found = findNode(root, id);
  if (!found) return root;
  const clone = reidSubtree;
  return mapTree(root, n => {
    if (!n.slots) return n;
    let changed = false;
    const slots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(n.slots)) {
      if (children.some(c => c.id === id)) {
        changed = true;
        const out: BlockNode[] = [];
        for (const c of children) {
          out.push(c);
          if (c.id === id) out.push(clone(found));
        }
        slots[name] = out;
      } else {
        slots[name] = children;
      }
    }
    return changed ? { ...n, slots } : n;
  });
}

export function updateNode(
  root: BlockNode,
  id: string,
  patch: Partial<BlockNode>
): BlockNode {
  return mapTree(root, n => (n.id === id ? { ...n, ...patch } : n));
}

export { DEFAULT_SLOT };
