/**
 * Which nodes of a stored document a reader is entitled to look at.
 *
 * One question with one answer, because two readers disagreeing about it is not
 * a cosmetic difference. The style compiler decides which nodes get rules; the
 * page-builder's class-usage record decides which classes a page is counted as
 * referencing, and that count is what a safe-delete check reads. If the counter
 * stops somewhere the compiler does not, a class can be applied to a rendered
 * element while being absent from the record that protects it — and absence is
 * indistinguishable from "not used".
 *
 * The two bounds were briefly the same NUMBERS reached by different walks, and
 * that is the shape this module exists to remove. Depth-first and level-order
 * both stop at `maxNodes`, but a document whose first root nests deeply spends
 * the whole budget inside that root under one walk and reaches later top-level
 * siblings under the other. Equal limits, different selections.
 *
 * ## What it guarantees
 *
 * - **Level order.** Every node at one depth is selected before any node below
 *   it, so a budget is spent breadth-first and a later top-level sibling is
 *   never starved by an earlier deep one.
 * - **Every entry counts.** The budget is spent on entries READ, not on entries
 *   that turned out usable, because reading is the work being bounded. An array
 *   made entirely of malformed entries would otherwise pass a cap without ever
 *   tripping it.
 * - **Slots in sorted order**, so two documents whose slots were written in a
 *   different order select identically.
 * - **It terminates on any input.** A document reaches here whether or not
 *   anything validated it: the walk is iterative, so depth cannot overflow the
 *   stack, and the node budget bounds a forest of any size.
 *
 * ## What it deliberately does NOT decide
 *
 * Anything a particular reader wants ON TOP of the selection — whether a node is
 * condition-gated, what to call the limit it hit, which of its fields to read.
 * Those differ per reader, and folding them in here would make one of them the
 * default for everybody. The selection is the shared part; the meaning is not.
 *
 * @module select-nodes
 */
import type { BlockNode } from "./document";
import { pointer } from "./issue-text";
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits";
import { isPlainRecord } from "./plain-record";

/** One selected node, with what a caller needs to place it in the document. */
export interface SelectedNode {
  node: BlockNode;
  /** JSON pointer resolving to this node within the document. */
  path: string;
  /** Nesting depth; top-level nodes are 1. */
  depth: number;
  /**
   * Index into the same `nodes` array of the node whose slot holds this one,
   * or `-1` for a top-level node.
   *
   * Present so a caller can inherit a decision down the tree — gating being the
   * one that exists today — without walking again. Level order guarantees a
   * parent appears before its children, so a single forward pass can carry an
   * inherited value with no second traversal and no lookup by id.
   */
  parent: number;
}

/** Why a selection stopped before reaching the end of the document. */
export interface SelectionStop {
  /** Pointer to the level the walk gave up on. */
  path: string;
  reason: "depth" | "count";
  /** The limit that was reached, so a caller can name it without re-reading. */
  limit: number;
}

/** The nodes a reader may look at, and whether it saw all of them. */
export interface NodeSelection {
  nodes: SelectedNode[];
  /**
   * Set only when a bound ended the walk early.
   *
   * Absent means the whole document was selected — which is what lets a caller
   * treat a missing node as genuinely absent rather than possibly unread. A
   * selection that truncated silently would make every absence ambiguous.
   */
  stopped?: SelectionStop;
}

/** One slot's children, queued with what their entries will need. */
interface Level {
  nodes: readonly BlockNode[];
  base: string;
  depth: number;
  /** Index in the selection of the node owning this slot, or -1 at the top. */
  owner: number;
}

/** Queue a node's slot children, in sorted slot order. */
function queueChildren(
  node: Record<string, unknown>,
  path: string,
  depth: number,
  owner: number,
  queue: Level[]
): void {
  if (!isPlainRecord(node.slots)) return;
  // Sorted, so two documents whose slots were written in a different order
  // still select the same nodes in the same order.
  for (const slot of Object.keys(node.slots).sort()) {
    const children = node.slots[slot];
    if (!Array.isArray(children)) continue;
    queue.push({
      nodes: children,
      base: pointer(pointer(path, "slots"), slot),
      depth: depth + 1,
      owner,
    });
  }
}

/**
 * Read one level, appending what it selects and queueing its children.
 *
 * Returns the stop that ended the whole selection, or `undefined` when the
 * level was read to the end.
 */
function selectLevel(
  level: Level,
  limits: DocumentLimits,
  nodes: SelectedNode[],
  queue: Level[],
  budget: { spent: number }
): SelectionStop | undefined {
  // An indexed loop rather than `forEach`, and counting every ENTRY rather than
  // every entry that turned out usable. `forEach` cannot be returned out of, so
  // reaching the cap would still walk the rest of an oversized array; and a
  // malformed entry never reaches the selection, so an array made entirely of
  // them would pass the cap without ever tripping it.
  for (let index = 0; index < level.nodes.length; index += 1) {
    if (budget.spent >= limits.maxNodes) {
      return { path: level.base, reason: "count", limit: limits.maxNodes };
    }
    budget.spent += 1;
    const node = level.nodes[index];
    if (!isPlainRecord(node) || typeof node.id !== "string") continue;
    const path = pointer(level.base, index);
    const owner = nodes.length;
    nodes.push({ node, path, depth: level.depth, parent: level.owner });
    queueChildren(node, path, level.depth, owner, queue);
  }
  return undefined;
}

/** The nodes of `doc` a reader may look at, in level order, within `limits`. */
export function selectNodes(
  // Typed by what it READS, not by `BlockDocument`. This exists to walk
  // documents nothing validated, so a parameter demanding the validated type
  // would make every honest caller assert its way past the very uncertainty
  // this function is built to handle. `BlockDocument` satisfies it structurally.
  doc: { nodes?: unknown },
  limits: DocumentLimits = DEFAULT_LIMITS
): NodeSelection {
  const nodes: SelectedNode[] = [];
  if (!Array.isArray(doc.nodes)) return { nodes };

  // A worklist rather than recursion. A stored document is not required to have
  // been validated before it is read — a render pass may validate forgivingly,
  // or not at all — and a deeply nested slot chain would then overflow the
  // stack and fail the request with a RangeError instead of returning an
  // answer.
  //
  // Reading the queue in order is what makes the selection level-ordered: a
  // level's children are appended behind every level already waiting, so every
  // node at one depth is selected before any node below it.
  const queue: Level[] = [
    { nodes: doc.nodes, base: "/nodes", depth: 1, owner: -1 },
  ];
  const budget = { spent: 0 };
  let stopped: SelectionStop | undefined;

  for (let at = 0; at < queue.length && stopped === undefined; at += 1) {
    const level = queue[at];
    if (level === undefined) continue;
    // An EMPTY level past the depth bound truncates nothing, so it must not
    // report a stop. A node sitting at exactly `maxDepth` with a declared empty
    // slot queues one, and treating that as truncation would mark a
    // structurally valid document incomplete forever — no usable record, and a
    // rebuild reporting it undetermined on every run.
    if (level.nodes.length === 0) continue;
    stopped =
      level.depth > limits.maxDepth
        ? { path: level.base, reason: "depth", limit: limits.maxDepth }
        : selectLevel(level, limits, nodes, queue, budget);
  }

  return stopped === undefined ? { nodes } : { nodes, stopped };
}
