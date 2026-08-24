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
 * One step of the walk: a list being read, or the moment a subtree ends.
 *
 * A LIST rather than a node, so a forest is never copied onto the stack to be
 * walked. Seeding one entry per top-level node would read the whole array and
 * allocate against it before any bound applied, which makes a budget powerless
 * against the cheapest oversized document there is: a very wide root array.
 * Holding the array with a cursor spends memory on DEPTH, not on width.
 *
 * The `leave` marker is what makes ancestry observable in an iterative walk. A
 * recursive one knows it has left a subtree because the call returns; a stack
 * has to be told, so each node queues its own marker BEFORE its children and
 * the marker is reached again only after every descendant.
 */
type Frame =
  | {
      kind: "list";
      nodes: readonly unknown[];
      index: number;
      parent: BlockNode | undefined;
    }
  | { kind: "leave"; node: unknown };

/** How a caller narrows the walk. */
export interface WalkOptions {
  /** Reported as the parent of the top-level nodes. */
  parent?: BlockNode;
  /**
   * Stop after reading this many entries.
   *
   * ENTRIES, not nodes visited: a forest can begin with a long run of nulls or
   * primitives that never reach the callback, and a bound counting callbacks
   * cannot see them. Reading is the work being bounded, and `selectNodes`
   * bounds the same quantity so a caller reasons about one budget.
   *
   * A bound the caller applies in its own callback is not this either: the
   * callback can decline to do work, but the walk has already reached every
   * remaining entry. This ends the traversal.
   */
  maxNodes?: number;
  /**
   * Called for each node skipped because it is its own ancestor.
   *
   * The walk is the only place that knows — detecting a cycle is a property of
   * having traversed — so it reports rather than leaving each caller to find
   * out by traversing again. Readers ignore this and keep walking; a WRITER has
   * to refuse, because a cycle it accepts becomes a forest that later recursive
   * operations cannot traverse at all.
   */
  onCycle?: (node: BlockNode) => void;
}

/**
 * The third argument in either of its accepted forms.
 *
 * `walkNodes` published a bare `parent` here before it took options, and a
 * caller compiled against that signature passes a node. Rejecting it is not an
 * option a type can enforce at runtime: the property lookup would simply miss
 * and every top-level callback would receive `undefined` as its parent, which
 * is a wrong answer rather than an error. The two shapes have no property in
 * common, so `id` separates them exactly.
 */
function toWalkOptions(
  third: BlockNode | WalkOptions | undefined
): WalkOptions {
  if (third === undefined) return {};
  return "id" in third ? { parent: third } : third;
}

/** Queue a node's slot children so they are read before the next sibling. */
function pushChildren(stack: Frame[], node: BlockNode): void {
  if (!node.slots) return;
  const slots = Object.values(node.slots);
  // Reversed, so the first slot ends up on top of the stack and is read first.
  for (let s = slots.length - 1; s >= 0; s -= 1) {
    const children = slots[s];
    // A slot whose value is not an array is skipped rather than read. Persisted
    // documents reach this walk unvalidated, and iterating a non-array throws.
    if (!Array.isArray(children)) continue;
    stack.push({ kind: "list", nodes: children, index: 0, parent: node });
  }
}

/**
 * Take the next unread entry, discarding frames that are finished on the way.
 *
 * Leaving a subtree is what removes its node from the ancestor path, so that
 * happens here: it is a property of the stack unwinding rather than of any node
 * being visited.
 */
function takeNext(
  stack: Frame[],
  onPath: Set<unknown>
): { node: unknown; parent: BlockNode | undefined } | undefined {
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top === undefined) return undefined;
    if (top.kind === "leave") {
      stack.pop();
      onPath.delete(top.node);
      continue;
    }
    if (top.index >= top.nodes.length) {
      stack.pop();
      continue;
    }
    const node = top.nodes[top.index];
    top.index += 1;
    return { node, parent: top.parent };
  }
  return undefined;
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
 * `RangeError: Maximum call stack size exceeded`, no cycle involved.
 *
 * A node is skipped when it is already ON THE PATH from the root to itself,
 * which is what a cycle is. That is deliberately narrower than skipping every
 * node seen anywhere: the same node OBJECT placed in two different slots is not
 * a cycle, and a walk that visited it once would report a subtree containing one
 * duplicated id as containing none — which is exactly the question
 * `insertionIsUnsafe` asks this walk, and the answer that would let `insertNode`
 * build a forest addressing two positions by one id.
 */
export function walkNodes(
  nodes: BlockNode[],
  fn: (node: BlockNode, parent: BlockNode | undefined) => void,
  parent?: BlockNode
): void;
export function walkNodes(
  nodes: BlockNode[],
  fn: (node: BlockNode, parent: BlockNode | undefined) => void,
  options?: WalkOptions
): void;
export function walkNodes(
  nodes: BlockNode[],
  fn: (node: BlockNode, parent: BlockNode | undefined) => void,
  third?: BlockNode | WalkOptions
): void {
  if (!Array.isArray(nodes)) return;
  const options = toWalkOptions(third);
  const limit = options.maxNodes ?? Number.POSITIVE_INFINITY;
  if (limit <= 0) return;

  const onPath = new Set<unknown>();
  // ONE frame for the whole top level. Reading the roots array through a cursor
  // is what keeps a budget meaningful against a very wide forest: entries are
  // taken one at a time and the walk returns the moment the budget is spent, so
  // a million roots with a budget of ten reads ten of them.
  const stack: Frame[] = [
    { kind: "list", nodes, index: 0, parent: options.parent },
  ];

  // Every entry READ spends the budget, not every entry that turned out to be a
  // node. Reading is the work being bounded, so a forest beginning with a long
  // run of nulls or primitives would otherwise be traversed in full while the
  // budget sat untouched — the callback never fires, and a bound counting
  // callbacks cannot see it. `selectNodes` bounds the same quantity, for the
  // same reason, and the two agreeing is what lets a caller reason about one
  // budget rather than two.
  //
  // Checked BEFORE taking the next entry rather than after using it, so
  // "entries read" is exactly what the number means.
  let read = 0;
  for (;;) {
    if (read >= limit) return;
    const entry = takeNext(stack, onPath);
    if (entry === undefined) return;
    read += 1;

    if (!isWalkableNode(entry.node)) continue;
    if (onPath.has(entry.node)) {
      options.onCycle?.(entry.node);
      continue;
    }

    onPath.add(entry.node);
    fn(entry.node, entry.parent);
    stack.push({ kind: "leave", node: entry.node });
    pushChildren(stack, entry.node);
  }
}

/** Find a node anywhere in the forest by id. */
export function findNode(
  nodes: BlockNode[],
  id: string
): BlockNode | undefined {
  return findWithin(nodes, id, new Set());
}

/**
 * `findNode`, carrying the ancestors the current forest was reached through.
 *
 * The path is what makes a MISS terminate. A hit returns before descending
 * further, so a lookup for an id that is present has always worked even on a
 * cyclic document — which is exactly why this went unnoticed: the failure needs
 * an id that is ABSENT, and asking for one that is not there is the ordinary
 * case for any lookup that can miss.
 *
 * A node reached through itself is not descended into again; the back edge is
 * simply not followed, so the search still covers everything reachable without
 * a cycle.
 */
function findWithin(
  nodes: BlockNode[],
  id: string,
  path: ReadonlySet<unknown>
): BlockNode | undefined {
  if (!Array.isArray(nodes)) return undefined;
  for (const node of nodes) {
    // Persisted forests reach these primitives unvalidated, so an entry may be
    // `null` or a primitive and reading `id` off one throws.
    if (typeof node !== "object" || node === null) continue;
    if (node.id === id) return node;
    if (path.has(node) || !node.slots) continue;
    const hit = findBelow(node, id, path);
    if (hit) return hit;
  }
  return undefined;
}

/** Search a node's slots, with that node added to the ancestor path. */
function findBelow(
  node: BlockNode,
  id: string,
  path: ReadonlySet<unknown>
): BlockNode | undefined {
  const below: ReadonlySet<unknown> = new Set(path).add(node);
  for (const children of Object.values(node.slots ?? {})) {
    if (!Array.isArray(children)) continue;
    const hit = findWithin(children, id, below);
    if (hit) return hit;
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
  fn: (node: BlockNode) => BlockNode,
  path: ReadonlySet<unknown> = new Set()
): BlockNode[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map(node => {
    // Unvalidated entries reach here, and `fn` is written for nodes.
    if (typeof node !== "object" || node === null) return node;
    const mapped = fn(node);
    if (!mapped.slots) return mapped;
    // A node reached through itself CANNOT be rebuilt: the result would have to
    // contain itself, and the attempt recurses until the stack runs out. The
    // back edge is dropped instead, so the rebuild returns a finite forest with
    // the cycle broken rather than failing the caller's operation outright.
    //
    // Dropping rather than keeping is the only option that terminates, and it
    // is the repair a caller would want anyway: an immutable rebuild of a
    // cyclic forest is not a thing that exists.
    if (path.has(node)) {
      const { slots: _cyclic, ...withoutSlots } = mapped;
      return withoutSlots;
    }
    const below: ReadonlySet<unknown> = new Set(path).add(node);
    const slots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(mapped.slots)) {
      slots[name] = mapForest(children, fn, below);
    }
    return { ...mapped, slots };
  });
}

/** Clamp an insertion index into a list's valid range. */
function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

/**
 * True if inserting `node` into `nodes` would produce a forest the primitives
 * can no longer address or traverse.
 *
 * Three ways, and they are rejected together because the consequence is the
 * same: the incoming subtree carries a duplicate id WITHIN itself, one of its
 * ids already lives in the destination forest, or it contains a CYCLE.
 *
 * Collapsing duplicate incoming ids into the set would let an internally
 * malformed subtree through and corrupt id-addressing after insertion.
 *
 * The cycle is asked of the walk rather than looked for here. `walkNodes` is
 * cycle-TOLERANT by design — a reader counting classes or measuring a document
 * must answer rather than fail — so a cycle is invisible in what it visits, and
 * a guard reading only the visits would call a cyclic subtree clean. What the
 * walk reports is therefore the only account of it, and a second traversal
 * written here to look again would be a second definition of the same thing.
 *
 * Refusing matters more for the writer than tolerating does for the reader: a
 * top-level insert would return a forest that is itself cyclic, and an insert
 * into a parent reaches the recursive `mapForest`, which has no such tolerance
 * and exits with `RangeError: Maximum call stack size exceeded`.
 */
function insertionIsUnsafe(nodes: BlockNode[], node: BlockNode): boolean {
  const incoming = new Set<string>();
  let internalDuplicate = false;
  let cyclic = false;
  walkNodes(
    [node],
    n => {
      if (incoming.has(n.id)) internalDuplicate = true;
      incoming.add(n.id);
    },
    {
      onCycle: () => {
        cyclic = true;
      },
    }
  );
  if (cyclic || internalDuplicate) return true;
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
  if (insertionIsUnsafe(nodes, node)) return nodes;
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
  return reidWithin(node, new Set());
}

/**
 * `reidSubtree`, carrying the ancestors this node was reached through.
 *
 * A node reached through itself has its slots dropped rather than rebuilt. The
 * re-id'd copy would otherwise have to contain a copy of itself, which is not a
 * finite structure — the recursion simply runs the stack out. Breaking the back
 * edge yields a duplicable subtree instead of failing the duplicate.
 */
function reidWithin(node: BlockNode, path: ReadonlySet<unknown>): BlockNode {
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
  if (slots && !path.has(node)) {
    const below: ReadonlySet<unknown> = new Set(path).add(node);
    const newSlots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(slots)) {
      if (!Array.isArray(children)) continue;
      newSlots[name] = children.map(child =>
        typeof child === "object" && child !== null
          ? reidWithin(child, below)
          : child
      );
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
