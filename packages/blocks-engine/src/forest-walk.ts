/**
 * The one iterative walk over a stored node forest.
 *
 * Every reader of a document needs the same three things and no two of them
 * agree on what to DO with an entry, so the traversal is shared and the
 * decision is not. Writing the walk per caller produced two copies that
 * differed only in their accumulator, which is the drift this repository has a
 * rule about — and each copy had to re-learn the same three hazards.
 *
 * ## What it guarantees
 *
 * - **Iterative.** Depth costs a frame, not a stack level. These run over
 *   documents nothing validated, so a chain deeper than the machine allows
 *   would otherwise exit with `RangeError` from inside the very helper a caller
 *   uses to REFUSE such a document.
 * - **Cycle-terminating.** A node reached through itself is not descended into
 *   again. Deliberately narrower than skipping every node already seen: one
 *   node object placed in two slots is two elements of the document, and
 *   counting it once reports half a real size and passes a cap the document
 *   exceeds.
 * - **Linear.** One mutable ancestor set with `leave` markers, not a copy per
 *   descent. Copying is correct and quadratic — measured, it took a
 *   five-thousand-node chain from under a millisecond to 159ms, in helpers
 *   whose whole purpose is bounding large documents.
 * - **Width-safe.** A list is held with a cursor rather than expanded into one
 *   frame per entry, so a very wide root array — the cheapest oversized
 *   document there is — costs one frame.
 *
 * ## What it leaves to the caller
 *
 * Whether an entry counts, whether to descend into it, and when to stop. A
 * counter counts malformed entries because its caps are about real element
 * counts; a renderer skips them because it has nothing to draw. Folding either
 * choice in here would make one caller's answer everybody's default.
 *
 * @module forest-walk
 */
import type { BlockNode } from "./document";

/** One entry the walk reached, with where it sits. */
export interface ForestEntry {
  /** Unvalidated: may be `null`, a primitive, or an array. */
  node: unknown;
  /** The node whose slot holds this entry, or `undefined` at the top level. */
  parent: BlockNode | undefined;
  /** Nesting depth; top-level entries are 1. */
  depth: number;
  /**
   * Whether this entry is its own ancestor — the point at which a cycle closes.
   *
   * Reported rather than silently skipped, because the two kinds of caller need
   * opposite things from it. A READER must tolerate a cycle and answer anyway;
   * a WRITER must refuse, since a cycle it accepts becomes a forest later
   * operations cannot traverse at all. The walk is the only place that knows —
   * detecting one is a property of having traversed — so a caller left to find
   * out for itself would need a second traversal and a second definition.
   *
   * The walk never descends into such an entry regardless of what is returned.
   */
  cycle: boolean;
}

/**
 * What the walk should do after an entry has been reported.
 *
 * `descend` reads the entry's slots next; `skip` leaves them unread; `stop`
 * abandons the walk with the stack unread, which is what makes a budget bound
 * the TRAVERSAL rather than only the work done per entry.
 */
export type ForestStep = "descend" | "skip" | "stop";

/** A source list being read, or the end of a subtree. */
type Frame =
  | {
      kind: "list";
      nodes: readonly unknown[];
      index: number;
      parent: BlockNode | undefined;
      depth: number;
    }
  | { kind: "leave"; node: unknown };

/**
 * Take the next unread entry, discarding frames that are finished on the way.
 *
 * Leaving a subtree is what removes its node from the ancestor path, so it
 * happens here: that is a property of the stack unwinding rather than of any
 * entry being visited.
 */
function takeNext(
  stack: Frame[],
  onPath: Set<unknown>
): { node: unknown; parent: BlockNode | undefined; depth: number } | undefined {
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
    return { node, parent: top.parent, depth: top.depth };
  }
  return undefined;
}

/** Queue a node's slot children so they are read before the next sibling. */
function pushSlots(stack: Frame[], block: BlockNode, depth: number): void {
  const lists = Object.values(block.slots ?? {});
  // Reversed so the first slot is read first: this is a pre-order walk, and a
  // caller reading a document in document order would otherwise see it mirrored
  // slot by slot.
  for (let i = lists.length - 1; i >= 0; i -= 1) {
    const children = lists[i];
    // A slot whose value is not an array is skipped rather than read. Persisted
    // documents arrive unvalidated and iterating a non-array throws.
    if (!Array.isArray(children)) continue;
    stack.push({
      kind: "list",
      nodes: children,
      index: 0,
      parent: block,
      depth: depth + 1,
    });
  }
}

/** Whether an entry is a value this walk can descend into. */
function isDescendable(node: unknown): node is BlockNode {
  // `Array.isArray` is checked separately because `typeof [] === "object"`.
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

/** Visit every entry of the forest, letting `onEntry` decide how to proceed. */
export function walkForest(
  nodes: readonly unknown[],
  onEntry: (entry: ForestEntry) => ForestStep
): void {
  if (!Array.isArray(nodes)) return;
  const onPath = new Set<unknown>();
  const stack: Frame[] = [
    { kind: "list", nodes, index: 0, parent: undefined, depth: 1 },
  ];

  for (;;) {
    const next = takeNext(stack, onPath);
    if (next === undefined) return;
    const { node, parent, depth } = next;

    const cycle = isDescendable(node) && onPath.has(node);
    const step = onEntry({ node, parent, depth, cycle });
    if (step === "stop") return;
    if (step === "skip") continue;

    // Asking to descend into something with no slots is not an error; it simply
    // has nowhere to go. Checked here so no caller has to.
    if (!isDescendable(node) || cycle || !node.slots) continue;

    onPath.add(node);
    stack.push({ kind: "leave", node });
    pushSlots(stack, node, depth);
  }
}
