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

/**
 * Settle a node's slots after a repair: keep the homes it declares, drop the property otherwise.
 *
 * Two opposite mistakes are possible once a stale key is removed, and each breaks something the
 * other fixes.
 *
 * Leaving an empty map behind breaks the WRITE path: validation refuses any slots object on a
 * block whose definition is not a container, before it looks at a single key, so the page would
 * still be refused with nothing left to remove.
 *
 * Deleting the property breaks the CANVAS: the editor builds a drop zone per STORED key, so a
 * container left holding no keys draws no drop target and stops accepting blocks — worst on the
 * page root, whose declared slot is the whole page.
 *
 * So a declared slot is restored as an empty array, and the property is dropped only when nothing
 * declares anything. `declared` is required rather than optional because a caller that forgets it
 * silently gets the canvas-breaking half.
 */
function withSlots(
  node: BlockNode,
  slots: Record<string, BlockNode[]>,
  declared: readonly string[] | undefined
): BlockNode {
  const settled = { ...slots };
  for (const name of declared ?? []) settled[name] ??= [];
  if (Object.keys(settled).length > 0) return { ...node, slots: settled };
  const next = { ...node };
  delete next.slots;
  return next;
}

/**
 * Remove one child from a NAMED slot, dropping the slot itself once nothing is left in it.
 *
 * `removeNode` searches every slot and leaves the emptied key behind, which is correct for an
 * ordinary delete: a slot the block declares exists whether or not anything sits in it. It is the
 * wrong shape for a slot the block does NOT declare, because validation refuses the slot's NAME
 * rather than its contents — so emptying such a slot child by child ends with a document that is
 * still refused and has nothing left to remove.
 */
export function removeFromSlot(
  root: BlockNode,
  parentId: string,
  slot: string,
  id: string,
  declared: readonly string[] | undefined
): BlockNode {
  return mapTree(root, n => {
    if (n.id !== parentId || !n.slots) return n;
    const remaining = (n.slots[slot] ?? []).filter(c => c.id !== id);
    const slots = { ...n.slots };
    if (remaining.length > 0) slots[slot] = remaining;
    else delete slots[slot];
    return withSlots(n, slots, declared);
  });
}

/**
 * Remove a whole slot from a node, contents and all.
 *
 * The repair for a slot nothing declares that is ALREADY empty: there is no child to address, and
 * the slot's own name is what validation refuses.
 */
export function removeSlot(
  root: BlockNode,
  parentId: string,
  slot: string,
  declared: readonly string[] | undefined
): BlockNode {
  return mapTree(root, n => {
    if (n.id !== parentId || !n.slots) return n;
    const slots = { ...n.slots };
    delete slots[slot];
    return withSlots(n, slots, declared);
  });
}

/**
 * Take the whole `slots` property off a node.
 *
 * For a block whose definition is not a container, holding slots is itself the fault, so there is
 * no individual name to remove — an empty map is refused exactly as a full one is.
 */
export function dropSlots(root: BlockNode, parentId: string): BlockNode {
  return mapTree(root, n => (n.id === parentId ? withSlots(n, {}, []) : n));
}

/**
 * Put a child inside a new block of `wrapperType`, in the same position it already held.
 *
 * The repair for a child a slot no longer admits, where the slot admits exactly one type that can
 * hold it. Removing such a child is also a repair and a far worse one: the block is drawn on the
 * canvas and the author can see it, so discarding it to satisfy a rule they never wrote loses work
 * whose only copy is that row.
 *
 * One wrapper per child rather than one around the run of them, because the children were siblings
 * and grouping them would change the arrangement while claiming to preserve it.
 */
export function wrapInSlot(
  root: BlockNode,
  parentId: string,
  slot: string,
  id: string,
  wrapperType: string
): BlockNode {
  return mapTree(root, n => {
    if (n.id !== parentId || !n.slots?.[slot]) return n;
    const children = n.slots[slot].map(child =>
      child.id === id
        ? makeNode(wrapperType, {}, undefined, { [DEFAULT_SLOT]: [child] })
        : child
    );
    return { ...n, slots: { ...n.slots, [slot]: children } };
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
