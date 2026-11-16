/**
 * Walking and finding: positions, walk options, `walkNodes`, `findNode` and
 * `locateNode`.
 *
 * @module tree-walk
 */
import type { BlockNode } from "./document";
import { isDescendable, walkForest } from "./forest-walk";

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
   * Called when the budget ran out, rather than the forest ending.
   *
   * The walk is the only place that knows, which is the reason `onCycle` is
   * here too: a caller counting its own callbacks cannot see the entries the
   * walk read and skipped, so a bound with no report is one that answers "I
   * finished" and "I gave up" identically — and it fails in the PASSING
   * direction, returning a partial answer as a whole one.
   *
   * It reports that `maxNodes` entries were READ and the walk stopped there.
   * Whether anything remained is a different question this cannot answer, so a
   * caller needing "more than N exist" bounds at N + 1 and reads this as the
   * proof: N + 1 entries read is N + 1 entries that exist.
   */
  onBudgetSpent?: () => void;
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
  if (limit <= 0) {
    options.onBudgetSpent?.();
    return;
  }

  let read = 0;
  let spent = false;
  walkForest(nodes, entry => {
    // Every entry READ spends the budget, not every entry that turned out to be
    // a node. Reading is the work being bounded, so a forest beginning with a
    // long run of nulls would otherwise be traversed in full while the budget
    // sat untouched — the callback never fires, and a bound counting callbacks
    // cannot see it. `selectNodes` bounds the same quantity for the same reason.
    read += 1;
    if (read >= limit) spent = true;
    // The WALK's own classification, not a second one beside it. An entry the
    // walk declined to descend into is exactly an entry no caller can read
    // fields off, and the two spellings this module used to carry differed in
    // nothing but which of them a hostile entry crashed in.
    if (!isDescendable(entry.node)) return read >= limit ? "stop" : "skip";

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
  if (spent) options.onBudgetSpent?.();
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
    if (!isDescendable(entry.node)) return "skip";
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
  // Read defensively at every step. This is a stored document and nothing here
  // has validated it — a slot may hold `null` instead of an array, and a list
  // may hold a hole — so an entry is asked for its id rather than assumed to
  // have one. It matters because ONE damaged node anywhere in the forest would
  // otherwise throw, and the caller looking for a completely unrelated
  // selection elsewhere in the document gets a crash instead of an answer.
  const topIndex = nodes.findIndex(node => node?.id === id);
  if (topIndex !== -1) return { index: topIndex };
  let found: NodeLocation | undefined;
  walkNodes(nodes, node => {
    if (found || !node.slots) return;
    for (const [slot, children] of Object.entries(node.slots)) {
      if (!Array.isArray(children)) continue;
      const index = children.findIndex(child => child?.id === id);
      if (index !== -1) {
        found = { parent: node, slot, index };
        return;
      }
    }
  });
  return found;
}
