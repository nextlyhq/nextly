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

/**
 * One step of the walk: a node to visit, or the moment its subtree ends.
 *
 * The `leave` marker is what makes ancestry observable in an iterative walk.
 * A recursive one knows it has left a subtree because the call returns; a
 * stack has to be told, so each node queues its own marker BEFORE its children
 * and the marker therefore pops after every descendant.
 */
type PendingNode =
  | { kind: "visit"; node: unknown; parent: BlockNode | undefined }
  | { kind: "leave"; node: unknown };

/** How a caller narrows the walk. */
export interface WalkOptions {
  /** Reported as the parent of the top-level nodes. */
  parent?: BlockNode;
  /**
   * Stop after visiting this many nodes.
   *
   * A bound the caller applies in its own callback is not this: the callback
   * can decline to do work, but the walk has already queued and popped every
   * remaining node, so a corrupt document still costs time and memory
   * proportional to the whole stored tree. This ends the traversal.
   */
  maxNodes?: number;
}

/**
 * Queue a node's slot children so that popping them restores written order.
 *
 * Both loops run backwards for that reason: a stack returns what went on last,
 * so pushing in order would hand a caller the document mirrored — slot by slot
 * and sibling by sibling.
 *
 * A slot whose value is not an array is skipped rather than read. Persisted
 * documents reach this walk unvalidated, and iterating a non-array throws.
 */
function pushChildren(stack: PendingNode[], node: BlockNode): void {
  if (!node.slots) return;
  const slots = Object.values(node.slots);
  for (let s = slots.length - 1; s >= 0; s--) {
    const children = slots[s];
    if (!Array.isArray(children)) continue;
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ kind: "visit", node: children[i], parent: node });
    }
  }
}

/** Whether an entry is a value this walk can treat as a node. */
function isWalkableNode(node: unknown): node is BlockNode {
  // `Array.isArray` is checked SEPARATELY because `typeof [] === "object"`, so
  // the type test alone hands an array to `fn` as though it were a node. Every
  // caller then reads its fields as `undefined` rather than failing: an
  // id-uniqueness check sees `undefined` and compares it against other
  // `undefined`s, a class reader finds no classes, a renderer finds no type.
  // Silence in each case, from a value none of them can act on.
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

/**
 * Depth-first visit over the forest: each node, then its slots' children in
 * order.
 *
 * The forest reaches here from persisted data whether or not anything validated
 * it — the blocks field admits any value whose `nodes` is an array — so an entry
 * may be `null` or a primitive, and a slot's children may not be an array at
 * all. Those are skipped rather than reported, because a walk has nobody to
 * report to: a caller that needs to know an entry was unreadable is asking a
 * validation question, and validation is where that answer lives. Skipping also
 * matches what the renderer does with the same shapes, so a reader counting
 * references here agrees with what the page actually applies.
 *
 * Iterative rather than recursive, because the forest's DEPTH is bounded by
 * nothing that has run before this. `MAX_DEPTH` is a validation rule, and a
 * document arrives whether or not validation ever passed on it — measured, a
 * chain about ten thousand deep exited a recursive walk with
 * `RangeError: Maximum call stack size exceeded`, no cycle involved. An
 * explicit stack removes the limit rather than raising it.
 *
 * A node is skipped when it is already ON THE PATH from the root to itself,
 * which is what a cycle is. That is deliberately narrower than skipping every
 * node seen anywhere: the same node OBJECT placed in two different slots is not
 * a cycle, and a walk that visited it once would report a subtree containing one
 * duplicated id as containing none — which is exactly the question
 * `insertionBreaksIdUniqueness` asks this walk, and the answer that would let
 * `insertNode` build a forest addressing two positions by one id.
 */
export function walkNodes(
  nodes: BlockNode[],
  fn: (node: BlockNode, parent: BlockNode | undefined) => void,
  options: WalkOptions = {}
): void {
  if (!Array.isArray(nodes)) return;
  const limit = options.maxNodes ?? Number.POSITIVE_INFINITY;
  if (limit <= 0) return;

  const onPath = new Set<unknown>();
  const stack: PendingNode[] = [];
  for (let i = nodes.length - 1; i >= 0; i--) {
    stack.push({ kind: "visit", node: nodes[i], parent: options.parent });
  }

  let visited = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    if (entry.kind === "leave") {
      onPath.delete(entry.node);
      continue;
    }
    if (!isWalkableNode(entry.node) || onPath.has(entry.node)) continue;

    onPath.add(entry.node);
    fn(entry.node, entry.parent);
    visited++;
    // Returning here rather than breaking out of the descent leaves the stack
    // unread, which is the point: the budget bounds the traversal, not just the
    // work done per node.
    if (visited >= limit) return;

    stack.push({ kind: "leave", node: entry.node });
    pushChildren(stack, entry.node);
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
 * True if inserting `node` into `nodes` would break id uniqueness — either the
 * incoming subtree carries a duplicate id WITHIN itself, or one of its ids
 * already lives in the destination forest. Both are rejected: collapsing
 * duplicate incoming ids into the set would let an internally malformed subtree
 * through and corrupt id-addressing after insertion.
 */
function insertionBreaksIdUniqueness(
  nodes: BlockNode[],
  node: BlockNode
): boolean {
  const incoming = new Set<string>();
  let internalDuplicate = false;
  walkNodes([node], n => {
    if (incoming.has(n.id)) internalDuplicate = true;
    incoming.add(n.id);
  });
  if (internalDuplicate) return true;
  let overlapsForest = false;
  walkNodes(nodes, n => {
    if (incoming.has(n.id)) overlapsForest = true;
  });
  return overlapsForest;
}

/**
 * Insert a node at a position. Returns the forest unchanged (the no-op contract
 * used across these primitives) when the target is invalid: an unknown parent
 * id, a slot position missing its slot, or a node that would break id
 * uniqueness — a subtree with an internal duplicate id, or an id that already
 * lives in the forest. The uniqueness guard is what makes the primitive safe:
 * re-inserting an existing node would corrupt id-addressing and, for a
 * self/descendant target, make `mapForest` recurse into the object just
 * inserted. Callers duplicating content pass a `reidSubtree` clone.
 */
export function insertNode(
  nodes: BlockNode[],
  node: BlockNode,
  at: TreePosition
): BlockNode[] {
  if (insertionBreaksIdUniqueness(nodes, node)) return nodes;
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

/**
 * Remove a node (and its subtree) wherever it lives, including the top level.
 * Returns the original forest reference untouched when the id is absent, so a
 * no-op delete never produces a spurious new tree for change-tracking callers.
 */
export function removeNode(nodes: BlockNode[], id: string): BlockNode[] {
  if (!findNode(nodes, id)) return nodes;
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
    // A slot position must name its slot; without this guard the remove below
    // would succeed and the re-insert would no-op, silently losing the node.
    if (to.slot === undefined) return nodes;
    // Cycle guard: the destination parent must not be the node or inside it.
    if (to.parentId === id || findNode([moving], to.parentId)) return nodes;
    if (!findNode(nodes, to.parentId)) return nodes;
  }
  const without = removeNode(nodes, id);
  const next = insertNode(without, moving, to);
  // The move must be atomic. If the re-insert refused — which happens only when
  // the moving subtree is itself already malformed (an internal duplicate id) —
  // `insertNode` returns the `without` forest unchanged; committing that would
  // drop the subtree. Fall back to the original forest so a bad document is
  // left as-is rather than losing content.
  return next === without ? nodes : next;
}

/** Deep-clone a subtree, assigning fresh ids to every node (copy/paste, patterns). */
export function reidSubtree(node: BlockNode): BlockNode {
  // Clone only this node's own fields; descendants are cloned by the recursive
  // calls below, so cloning `slots` here too would deep-copy them twice.
  const { slots, ...own } = node;
  const copy: BlockNode = { ...structuredClone(own), id: newId() };
  // A re-id'd node is a distinct element: it must not carry the original's DOM
  // id, or the two would emit duplicate HTML `id` attributes. The id can arrive
  // two ways — the dedicated `cssId` field and the custom-attributes escape
  // hatch (`attributes.id`, matched case-insensitively) — so drop both.
  delete copy.cssId;
  if (copy.attributes) {
    const attributes = Object.fromEntries(
      Object.entries(copy.attributes).filter(
        ([key]) => key.toLowerCase() !== "id"
      )
    );
    if (Object.keys(attributes).length > 0) copy.attributes = attributes;
    else delete copy.attributes;
  }
  if (slots) {
    const newSlots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(slots)) {
      newSlots[name] = children.map(reidSubtree);
    }
    copy.slots = newSlots;
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
