/**
 * Document limits. Hard caps reject a document outright; the warning ratio
 * lets tooling surface "approaching the limit" before authors hit a wall.
 */
import type { BlockDocument, BlockNode } from "./document";

/** Maximum nesting depth of nodes (top-level nodes are depth 1). */
export const MAX_DEPTH = 12;

/** Maximum total nodes in one document. */
export const MAX_NODES = 5000;

/** Default maximum serialized document size in bytes (2 MiB). */
// Written as a literal rather than as `2 * 1024 * 1024`, because the literal
// TYPE is what the freeze asserts. TypeScript does not fold the arithmetic when
// inferring, so the computed form widens to `number` and a freeze assertion
// over it accepts every possible cap — no assertion at all. The comment carries
// the readability the expression used to.
export const DEFAULT_MAX_DOCUMENT_BYTES = 2_097_152; // 2 MiB

/** Fraction of a cap at which tooling should warn (80%). */
export const LIMIT_WARNING_RATIO = 0.8;

/** The default slot name for container blocks with a single child region. */
export const DEFAULT_SLOT = "children";

/** Effective limits for one validation/compile run; callers may raise the byte cap. */
export interface DocumentLimits {
  maxDepth: number;
  maxNodes: number;
  maxBytes: number;
}

export const DEFAULT_LIMITS: DocumentLimits = {
  maxDepth: MAX_DEPTH,
  maxNodes: MAX_NODES,
  maxBytes: DEFAULT_MAX_DOCUMENT_BYTES,
};

/**
 * Queue a node's slot children for the counter, carrying the ancestors below it.
 *
 * Enqueued one at a time. `push(...children)` passes each child as a call
 * ARGUMENT, and V8 caps those near 100k — so a slot wider than that throws a
 * native RangeError from inside the counter, before any caller can refuse the
 * document for being too large. The count exists to reject exactly that
 * document.
 *
 * A malformed slot value (a non-array) is skipped: these helpers run over
 * untrusted documents during validation and must not throw.
 */
function enqueueChildren(
  node: BlockNode,
  path: ReadonlySet<unknown>,
  queue: { node: BlockNode; path: ReadonlySet<unknown> }[]
): void {
  if (typeof node !== "object" || node === null || !node.slots) return;
  const below: ReadonlySet<unknown> = new Set(path).add(node);
  for (const children of Object.values(node.slots)) {
    if (!Array.isArray(children)) continue;
    for (const child of children) queue.push({ node: child, path: below });
  }
}

/** Total node count across the forest, slots included. */
export function countNodes(nodes: BlockNode[]): number {
  let count = 0;
  // Index-based walk so every array element is counted, including malformed
  // ones (null, a primitive): the node cap must reflect the real element count
  // so an array padded with junk cannot slip past it. Only well-formed objects
  // are descended into.
  // Each entry carries the ancestors it was reached through, so a slot holding
  // one of its own ancestors is not descended into again. Without it the queue
  // gains entries forever on a cyclic document and this exits with a native
  // RangeError — from inside the counter whose job is to let a caller REFUSE
  // such a document.
  //
  // Ancestors rather than everything seen, because the two differ where it
  // matters: one node object placed in two slots is two elements of this
  // document and is counted twice, exactly as it is today. Only a true cycle is
  // cut, and only where it closes.
  const queue: { node: BlockNode; path: ReadonlySet<unknown> }[] = nodes.map(
    node => ({ node, path: new Set() })
  );
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]?.node;
    const path = queue[i]?.path ?? new Set();
    count++;
    if (path.has(node)) continue;
    enqueueChildren(node, path, queue);
  }
  return count;
}

/** Deepest nesting level in the forest; an empty forest is depth 0. */
export function treeDepth(nodes: BlockNode[]): number {
  let deepest = 0;
  // Carries the ancestors each entry was reached through, for the reason the
  // node counter does: a slot holding one of its own ancestors otherwise makes
  // this walk gain entries forever while `depth` climbs without bound, and it
  // does not crash — it SPINS. A hang holds a request open and presents as
  // slowness somewhere unrelated, which is the failure nobody attributes here.
  //
  // Ancestors rather than everything seen: the deepest path to a node shared
  // between two branches is still the answer, and only a cycle is cut.
  const stack: Array<{
    node: BlockNode;
    depth: number;
    path: ReadonlySet<unknown>;
  }> = nodes.map(node => ({ node, depth: 1, path: new Set() }));
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    if (entry.depth > deepest) deepest = entry.depth;
    if (entry.path.has(entry.node)) continue;
    // A malformed array element (null, or a non-object) has no slots and must
    // not be dereferenced: validation runs this over untrusted documents.
    if (
      typeof entry.node === "object" &&
      entry.node !== null &&
      entry.node.slots
    ) {
      // Skip malformed (non-array) slot values so untrusted documents passed in
      // during validation cannot make this throw.
      for (const children of Object.values(entry.node.slots)) {
        if (!Array.isArray(children)) continue;
        const below: ReadonlySet<unknown> = new Set(entry.path).add(entry.node);
        for (const child of children) {
          stack.push({ node: child, depth: entry.depth + 1, path: below });
        }
      }
    }
  }
  return deepest;
}

/**
 * Serialized size of a document in bytes (UTF-8 of its JSON form — the same
 * bytes that hit storage, so the cap measures what actually gets persisted).
 */
export function documentBytes(doc: BlockDocument): number {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}
