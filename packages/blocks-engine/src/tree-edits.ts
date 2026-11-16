/**
 * Building and editing the forest: a fresh id and node, where an insert or
 * move lands, the shared rebuild the edits and copies use (`mapForest`),
 * insert, remove and move, and patching a node's own fields.
 *
 * @module tree-edits
 */
import type { BlockNode } from "./document";
import { isDescendable } from "./forest-walk";
import { defineEntry, ownEntry } from "./safe-record";
import { assembleSlots } from "./structural-sharing";
import { findNode, walkNodes } from "./tree-walk";

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
 * One step of an immutable rebuild: a source list being read, or a node whose
 * slots are now built and can be assembled.
 *
 * `close` sits BELOW its slot frames, so it is reached only after every
 * descendant has been rebuilt — which is what makes this a post-order walk
 * without recursion. Depth then costs a frame rather than a stack level, and
 * these primitives run on documents nothing validated.
 */
type BuildTask =
  | { kind: "read"; source: readonly unknown[]; index: number; out: unknown[] }
  | {
      kind: "close";
      source: unknown;
      mapped: BlockNode;
      built: Map<string, BlockNode[]>;
      out: unknown[];
    };

/**
 * Queue each of a node's slots for rebuilding, recording where each result goes.
 *
 * A slot whose stored value is not an array is left OUT of `built`, which is how
 * `assembleSlots` knows to keep it exactly as it was.
 */
function queueSlotRebuilds(
  stack: BuildTask[],
  mapped: BlockNode,
  built: Map<string, BlockNode[]>
): void {
  const names = Object.keys(mapped.slots ?? {});
  // Reversed so the first slot is rebuilt first.
  for (let i = names.length - 1; i >= 0; i -= 1) {
    const name = names[i];
    if (name === undefined) continue;
    const children = mapped.slots?.[name];
    if (!Array.isArray(children)) continue;
    const into: BlockNode[] = [];
    built.set(name, into);
    stack.push({ kind: "read", source: children, index: 0, out: into });
  }
}

/**
 * Immutably rebuild the forest, applying `fn` to every node.
 *
 * Three things it must not do, each learned from getting one of them wrong:
 *
 * A node reached through itself is DROPPED from its parent's list, not kept as
 * a childless copy. Keeping it returns a forest carrying that node's id twice —
 * `parent -> child -> parent` rebuilt as `[parent, child, parent]` — which makes
 * every id lookup ambiguous and fails the validation the repair was for. The
 * entry that closes the cycle is the one that cannot exist in a finite tree, so
 * it is the one that goes.
 *
 * A malformed ENTRY is passed through untouched rather than mapped. `fn` is
 * written for nodes and reads `id` off what it is given, so handing it a `null`
 * throws — and a caller editing an unrelated field has no business failing over
 * a neighbour it never named.
 *
 * A malformed SLOT VALUE is preserved exactly. Replacing it with an empty array
 * would let any unrelated edit silently destroy stored content that a caller
 * may still need to read or repair, which is a worse outcome than the throw it
 * replaced: the throw was loud and lost nothing.
 *
 * Published because those three are exactly what a caller rewriting one field
 * across a stored forest gets wrong, and each was learned here rather than
 * guessed. A planner stripping a lock or a provenance record wrote its own walk
 * and inherited none of them; the rule is that a forest rewrite is this
 * function with a different `fn`, not a new traversal.
 */
export function mapForest(
  nodes: BlockNode[],
  fn: (node: BlockNode) => BlockNode
): BlockNode[] {
  if (!Array.isArray(nodes)) return nodes;
  const rebuilt: unknown[] = [];
  const onPath = new Set<unknown>();
  const stack: BuildTask[] = [
    { kind: "read", source: nodes, index: 0, out: rebuilt },
  ];

  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top === undefined) break;

    if (top.kind === "close") {
      stack.pop();
      onPath.delete(top.source);
      top.out.push(assembleSlots(top.source, top.mapped, top.built));
      continue;
    }
    if (top.index >= top.source.length) {
      stack.pop();
      continue;
    }
    const entry = top.source[top.index];
    top.index += 1;

    if (!isDescendable(entry)) {
      top.out.push(entry);
      continue;
    }
    // The cycle closes here: this entry is its own ancestor, so it is omitted.
    if (onPath.has(entry)) continue;

    const mapped = fn(entry);
    // Anything that is not a slots RECORD is passed through untouched, not just
    // `undefined`. A stored `slots: null` — or a primitive — has no entries to
    // enumerate, and sending it on would replace it with `{}`: stored content
    // rewritten by an edit that named a different node. The recursive rebuild
    // this replaced kept such a node as it was, and losing that was a
    // regression rather than a change of policy.
    if (!isSlotsRecord(mapped.slots)) {
      top.out.push(mapped);
      continue;
    }

    onPath.add(entry);
    // A Map, not a record. Slot NAMES come from unvalidated stored data, and a
    // plain object answers for keys it never had: `built["constructor"]`
    // resolves `Object.prototype.constructor`, so a malformed slot deliberately
    // left out of this set would come back as a function and be dropped by
    // serialization — the stored value destroyed by an unrelated edit, which is
    // the exact loss preserving it was meant to prevent.
    const built = new Map<string, BlockNode[]>();
    stack.push({ kind: "close", source: entry, mapped, built, out: top.out });
    queueSlotRebuilds(stack, mapped, built);
  }

  return rebuilt as BlockNode[];
}

/** Whether a node's `slots` is a record this rebuild can enumerate. */
function isSlotsRecord(slots: unknown): slots is Record<string, BlockNode[]> {
  // `Array.isArray` separately, because `typeof [] === "object"` and an array
  // of slots is malformed rather than empty.
  return typeof slots === "object" && slots !== null && !Array.isArray(slots);
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
 * This refuses an incoming ARGUMENT, which is why it survives the rule that
 * these primitives do not refuse an already-unstorable document: a cyclic
 * subtree handed in by a caller ADDS a cycle to a forest that may not have had
 * one, rather than declining to work on damage that was already there.
 */
function checkInsertion(
  nodes: BlockNode[],
  node: BlockNode
): { unsafe: boolean; destinationCyclic: boolean } {
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
  if (cyclic || internalDuplicate) {
    return { unsafe: true, destinationCyclic: false };
  }
  let overlapsForest = false;
  let destinationCyclic = false;
  // Taken from the walk this already performs. The destination's own state is
  // needed to keep the two insertion paths in agreement, and asking for it
  // separately would be a second traversal answering a question this one has
  // already passed through.
  walkNodes(
    nodes,
    n => {
      if (incoming.has(n.id)) overlapsForest = true;
    },
    {
      onCycle: () => {
        destinationCyclic = true;
      },
    }
  );
  return { unsafe: overlapsForest, destinationCyclic };
}

/** A node, unchanged. The rebuild is the point; `mapForest` does the rest. */
function identity(node: BlockNode): BlockNode {
  return node;
}

/**
 * Rebuild a forest, dropping any entry that closes a cycle.
 *
 * Named because two callers need it for the same reason and neither is
 * transforming anything: a cycle-closing entry is the one thing in a stored
 * document that CANNOT round-trip through storage — `JSON.stringify` refuses
 * it — so a rebuild that omits it destroys nothing a caller could ever have
 * saved. That is what separates it from a malformed slot value, which is
 * preserved exactly: a strange value still writes and reads back, so dropping
 * one would lose real content.
 */
function withoutCycleEdges(nodes: BlockNode[]): BlockNode[] {
  return mapForest(nodes, identity);
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
  const check = checkInsertion(nodes, node);
  if (check.unsafe) return nodes;
  if (at.parentId === undefined) {
    // Rebuilt rather than copied when the destination carries a cycle, so both
    // insertion paths answer the same way. The path below reaches `mapForest`,
    // which drops a cycle-closing entry as it rebuilds; a plain array copy here
    // does not, so the same operation left the cycle in place for a top-level
    // target and removed it for a nested one — one primitive with two answers,
    // decided by where the caller happened to point it.
    const base = check.destinationCyclic ? withoutCycleEdges(nodes) : nodes;
    const next = [...base];
    next.splice(clampIndex(at.index, next.length), 0, node);
    return next;
  }
  const { parentId, slot, index } = at;
  if (slot === undefined) return nodes;
  if (!findNode(nodes, parentId)) return nodes;
  return mapForest(nodes, current => {
    if (current.id !== parentId) return current;
    const slots = { ...(current.slots ?? {}) };
    // Read and written through `safe-record`, because `slot` is a name from
    // outside this module and both halves fail on it independently. Reading
    // `slots["__proto__"]` on a record without that key yields
    // `Object.prototype` rather than `undefined`, so `?? []` does not fire and
    // the spread throws; writing it invokes the prototype setter and stores
    // nothing. Fixing either one alone leaves the other.
    const children = [...(ownEntry(slots, slot) ?? [])];
    children.splice(clampIndex(index, children.length), 0, node);
    defineEntry(slots, slot, children);
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
    // `Object.fromEntries` rather than a loop assigning into a fresh object.
    // Slot names come from stored data, and the loop form drops a `__proto__`
    // slot — an edit that named a DIFFERENT node silently deleting stored
    // content. `fromEntries` defines each key, so it keeps one. See
    // `safe-record` for the two spellings that do not.
    // A list that did not hold the id stays itself, and a node none of whose
    // lists held it is returned as itself (see `structural-sharing`).
    let held = false;
    const slots = Object.fromEntries(
      Object.entries(node.slots).map(([name, children]) => {
        const kept = children.filter(child => child.id !== id);
        if (kept.length === children.length) return [name, children];
        held = true;
        return [name, kept];
      })
    );
    return held ? { ...node, slots } : node;
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
  // Rebuilt before it is re-inserted, because the subtree came out of the
  // DOCUMENT rather than from the caller. `checkInsertion` refuses a cyclic
  // argument to stop a caller adding a cycle to a healthy forest, and a node
  // extracted from a document that was already cyclic is not that — refusing it
  // meant a damaged block could never be moved, which is the one thing an
  // author might do to get it out of the way.
  const [relocated] = withoutCycleEdges([moving]);
  const next = insertNode(without, relocated ?? moving, to);
  // The move must be atomic. If the re-insert refused — which happens only when
  // the moving subtree is itself already malformed (an internal duplicate id) —
  // `insertNode` returns the `without` forest unchanged; committing that would
  // drop the subtree. Fall back to the original forest so a bad document is
  // left as-is rather than losing content.
  return next === without ? nodes : next;
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
