/**
 * Pure, immutable, ID-addressed operations over a document's node forest.
 *
 * The document's top level is a plain array of nodes, so every operation works
 * on a `BlockNode[]` and treats "no parent id" as the top level. Every
 * mutation returns a new forest; inputs are never modified. Nodes are always
 * addressed by id — positional addressing exists only as the insertion index
 * within a destination, never as a way to identify a node.
 *
 * These are mechanism, not policy: they enforce structural safety (no cycles,
 * clamped indices, no-op on missing targets) but DELIBERATELY do not enforce
 * author policy. Two invariants are owned elsewhere on purpose:
 * - Author locks (`node.locked`) are enforced by the editor command layer, not
 *   here. System paths — migrations, locale-overlay application, `reidSubtree`,
 *   version restore — must be able to transform locked nodes; a lock check in
 *   these primitives would either block those paths or force a bypass flag onto
 *   every call site. Centralizing the check in the op store is the correct seam.
 * - Node id uniqueness is a document validation invariant, checked by
 *   `validate()` before a document is persisted. Callers build nodes with
 *   `makeNode`/`reidSubtree`, which mint fresh ids, so within a session ids are
 *   unique by construction; a hand-injected duplicate is caught by validation
 *   with a machine-readable path, not silently corrected here.
 */
import type { BlockNode } from "./document";

/** Stable unique node id. `crypto.randomUUID` exists in Node ≥ 20 and browsers. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Build a node with a fresh id. `version` is the block definition's schema version. */
export function makeNode(
  type: string,
  version: number,
  props: Record<string, unknown> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode {
  const node: BlockNode = { id: newId(), type, version, props };
  if (slots) node.slots = slots;
  return node;
}

/** Where an insert or move lands: a parent's slot, or the top level when `parentId` is absent. */
export interface TreePosition {
  parentId?: string;
  /** Required when `parentId` is set; ignored for top-level positions. */
  slot?: string;
  index: number;
}

/** Depth-first visit over the forest: each node, then its slots' children in order. */
export function walkNodes(
  nodes: BlockNode[],
  fn: (node: BlockNode, parent: BlockNode | undefined) => void,
  parent?: BlockNode
): void {
  for (const node of nodes) {
    fn(node, parent);
    if (node.slots) {
      for (const children of Object.values(node.slots)) {
        walkNodes(children, fn, node);
      }
    }
  }
}

/** Find a node anywhere in the forest by id. */
export function findNode(
  nodes: BlockNode[],
  id: string
): BlockNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.slots) {
      for (const children of Object.values(node.slots)) {
        const hit = findNode(children, id);
        if (hit) return hit;
      }
    }
  }
  return undefined;
}

/** A found node's placement: its parent (undefined at top level), slot, and index. */
export interface NodeLocation {
  parent?: BlockNode;
  slot?: string;
  index: number;
}

/** Locate a node's parent, slot, and index; undefined when the id is absent. */
export function locateNode(
  nodes: BlockNode[],
  id: string
): NodeLocation | undefined {
  const topIndex = nodes.findIndex(node => node.id === id);
  if (topIndex !== -1) return { index: topIndex };
  let found: NodeLocation | undefined;
  walkNodes(nodes, node => {
    if (found || !node.slots) return;
    for (const [slot, children] of Object.entries(node.slots)) {
      const index = children.findIndex(child => child.id === id);
      if (index !== -1) {
        found = { parent: node, slot, index };
        return;
      }
    }
  });
  return found;
}

/** Immutably rebuild the forest, applying `fn` to every node (parents before children). */
function mapForest(
  nodes: BlockNode[],
  fn: (node: BlockNode) => BlockNode
): BlockNode[] {
  return nodes.map(node => {
    const mapped = fn(node);
    if (!mapped.slots) return mapped;
    const slots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(mapped.slots)) {
      slots[name] = mapForest(children, fn);
    }
    return { ...mapped, slots };
  });
}

/** Clamp an insertion index into a list's valid range. */
function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

/**
 * Insert a node at a position. Inserting under an unknown parent id returns
 * the forest unchanged rather than silently dropping the node somewhere else.
 */
export function insertNode(
  nodes: BlockNode[],
  node: BlockNode,
  at: TreePosition
): BlockNode[] {
  if (at.parentId === undefined) {
    const next = [...nodes];
    next.splice(clampIndex(at.index, next.length), 0, node);
    return next;
  }
  const { parentId, slot, index } = at;
  if (slot === undefined) return nodes;
  if (!findNode(nodes, parentId)) return nodes;
  return mapForest(nodes, current => {
    if (current.id !== parentId) return current;
    const slots = { ...(current.slots ?? {}) };
    const children = [...(slots[slot] ?? [])];
    children.splice(clampIndex(index, children.length), 0, node);
    slots[slot] = children;
    return { ...current, slots };
  });
}

/** Remove a node (and its subtree) wherever it lives, including the top level. */
export function removeNode(nodes: BlockNode[], id: string): BlockNode[] {
  const withoutTop = nodes.filter(node => node.id !== id);
  return mapForest(withoutTop, node => {
    if (!node.slots) return node;
    const slots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(node.slots)) {
      slots[name] = children.filter(child => child.id !== id);
    }
    return { ...node, slots };
  });
}

/**
 * Move a node to a new position. Moves that would create a cycle (into the
 * node itself or its own subtree) or reference a missing node/parent return
 * the forest unchanged.
 */
export function moveNode(
  nodes: BlockNode[],
  id: string,
  to: TreePosition
): BlockNode[] {
  const moving = findNode(nodes, id);
  if (!moving) return nodes;
  if (to.parentId !== undefined) {
    // Cycle guard: the destination parent must not be the node or inside it.
    if (to.parentId === id || findNode([moving], to.parentId)) return nodes;
    if (!findNode(nodes, to.parentId)) return nodes;
  }
  const without = removeNode(nodes, id);
  return insertNode(without, moving, to);
}

/** Deep-clone a subtree, assigning fresh ids to every node (copy/paste, patterns). */
export function reidSubtree(node: BlockNode): BlockNode {
  const copy: BlockNode = { ...structuredClone(node), id: newId() };
  if (node.slots) {
    const slots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(node.slots)) {
      slots[name] = children.map(reidSubtree);
    }
    copy.slots = slots;
  }
  return copy;
}

/** Insert a re-id'd copy of a node immediately after the original. */
export function duplicateNode(nodes: BlockNode[], id: string): BlockNode[] {
  const found = findNode(nodes, id);
  if (!found) return nodes;
  const location = locateNode(nodes, id);
  if (!location) return nodes;
  return insertNode(nodes, reidSubtree(found), {
    parentId: location.parent?.id,
    slot: location.slot,
    index: location.index + 1,
  });
}

/**
 * Patch a node's own fields. `id`, `type`, and `slots` are not patchable here:
 * ids are immutable, type changes are conversions with their own semantics,
 * and children change through insert/remove/move.
 */
export function updateNode(
  nodes: BlockNode[],
  id: string,
  patch: Partial<Omit<BlockNode, "id" | "type" | "slots">>
): BlockNode[] {
  if (!findNode(nodes, id)) return nodes;
  return mapForest(nodes, node =>
    node.id === id ? { ...node, ...patch } : node
  );
}
