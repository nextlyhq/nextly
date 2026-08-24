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
 *
 * ## Storability is not decided here
 *
 * A stored document can arrive in a state `JSON.stringify` refuses — a value
 * that points back at its owner. Nothing in this module creates one; they come
 * from an import, a restore, or a direct database write.
 *
 * **These primitives never refuse work because the DOCUMENT they were given is
 * already unstorable.** They transform what they can reach and make no claim
 * about whether the result can be saved. One place decides that, once, at the
 * point of writing — `measureBytes` already answers it as
 * `{ exceeded: true, reason: "unwritable" }`, and it answers for the whole
 * class, including values a cycle check cannot see at all: `BigInt`, a
 * function, a getter that throws.
 *
 * The rule earns its keep by being derivable rather than remembered. Three
 * operations previously answered three different ways — rebuild, refuse,
 * preserve — each reasoned correctly from its own case, and the fourth case had
 * nothing to derive an answer from.
 *
 * What they DO refuse is an ARGUMENT that would break id-addressing: a subtree
 * carrying a duplicate id, or an id already in the destination. That is a
 * different question. It is about an invariant these primitives depend on to
 * work at all, and it concerns caller-supplied input rather than the state the
 * document was already in.
 */
import type { BlockNode } from "./document";
import { walkForest } from "./forest-walk";
import { defineEntry, ownEntry } from "./safe-record";

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
  const options = toWalkOptions(third);
  const limit = options.maxNodes ?? Number.POSITIVE_INFINITY;
  if (limit <= 0) return;

  let read = 0;
  walkForest(nodes, entry => {
    // Every entry READ spends the budget, not every entry that turned out to be
    // a node. Reading is the work being bounded, so a forest beginning with a
    // long run of nulls would otherwise be traversed in full while the budget
    // sat untouched — the callback never fires, and a bound counting callbacks
    // cannot see it. `selectNodes` bounds the same quantity for the same reason.
    read += 1;
    if (!isWalkableNode(entry.node)) return read >= limit ? "stop" : "skip";

    // The shared walk does not descend into a node already on the path, so an
    // entry reported twice at the same identity is the cycle closing. Reported
    // rather than silently skipped: a READER tolerates one, a WRITER has to
    // refuse, and the walk is the only place that knows.
    if (entry.cycle) {
      options.onCycle?.(entry.node);
      return read >= limit ? "stop" : "skip";
    }

    fn(entry.node, entry.parent ?? options.parent);
    return read >= limit ? "stop" : "descend";
  });
}

/** Find a node anywhere in the forest by id. */
export function findNode(
  nodes: BlockNode[],
  id: string
): BlockNode | undefined {
  let found: BlockNode | undefined;
  walkForest(nodes, entry => {
    // Persisted forests reach here unvalidated, so an entry may be `null` or a
    // primitive and reading `id` off one throws.
    if (!isWalkableNode(entry.node)) return "skip";
    if (entry.node.id === id) {
      found = entry.node;
      // Abandons the walk with the stack unread. A recursive search noticed a
      // cycle only AFTER descending to the repeated ancestor, so a cycle longer
      // than the call stack exhausted it before the guard ever ran — machine
      // depth was the real bound, not the guard.
      return "stop";
    }
    return "descend";
  });
  return found;
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
 */
function mapForest(
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
      top.out.push(assembleSlots(top.mapped, top.built));
      continue;
    }
    if (top.index >= top.source.length) {
      stack.pop();
      continue;
    }
    const entry = top.source[top.index];
    top.index += 1;

    if (!isWalkableNode(entry)) {
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

/** Put the rebuilt slots back on a node, keeping any slot that was not rebuilt. */
function assembleSlots(
  mapped: BlockNode,
  built: Map<string, BlockNode[]>
): BlockNode {
  const slots: Record<string, BlockNode[]> = {};
  for (const [name, original] of Object.entries(mapped.slots ?? {})) {
    // A slot absent from `built` held something this rebuild could not walk.
    // Keeping the stored value is the point: an unrelated edit must not be the
    // thing that destroys it.
    const value = built.get(name) ?? original;
    // DEFINED rather than assigned — the write-side twin of reading through a
    // `Map` above. `safe-record` carries why; it is shared because fixing this
    // one site left three others in the package with the plain-assignment form.
    defineEntry(slots, name, value);
  }
  return { ...mapped, slots };
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
    const slots = Object.fromEntries(
      Object.entries(node.slots).map(([name, children]) => [
        name,
        children.filter(child => child.id !== id),
      ])
    );
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
  // Rebuilt through the shared walk rather than by recursing here. It already
  // knows how to drop a cycle-closing entry, leave a malformed slot alone and
  // keep depth off the call stack, and a second traversal written here would be
  // a second set of answers to the same three questions.
  const [rebuilt] = mapForest([node], reidOne);
  return rebuilt ?? node;
}

/** One node's own fields, freshly identified. Slots are the rebuild's job. */
function reidOne(node: BlockNode): BlockNode {
  // Clone only this node's own fields; descendants are cloned as the rebuild
  // reaches them, so cloning `slots` here too would deep-copy them twice.
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
  // Handed back so the rebuild knows this node HAS slots to descend into; it
  // replaces them with the rebuilt lists.
  if (slots !== undefined) copy.slots = slots;
  return copy;
}

/** Insert a re-id'd copy of a node immediately after the original. */
export function duplicateNode(nodes: BlockNode[], id: string): BlockNode[] {
  const found = findNode(nodes, id);
  if (!found) return nodes;
  // No check that the forest can be serialized. This once refused outright when
  // any part of the forest was cyclic, which made it the only primitive that
  // declined work because of a defect elsewhere in the document — see the
  // storability note on this module.
  //
  // The clone is safe on its own terms regardless: `reidSubtree` rebuilds it
  // without the edge that closes a cycle, so what gets inserted is acyclic even
  // when its source was not.
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
