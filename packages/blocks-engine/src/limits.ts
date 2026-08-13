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
export const DEFAULT_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

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

/** Total node count across the forest, slots included. */
export function countNodes(nodes: BlockNode[]): number {
  let count = 0;
  // Index-based walk so every array element is counted, including malformed
  // ones (null, a primitive): the node cap must reflect the real element count
  // so an array padded with junk cannot slip past it. Only well-formed objects
  // are descended into.
  const queue: BlockNode[] = [...nodes];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    count++;
    if (typeof node === "object" && node !== null && node.slots) {
      // Guard against malformed slots (a non-array value): these helpers run
      // over untrusted documents during validation and must not throw.
      for (const children of Object.values(node.slots)) {
        if (!Array.isArray(children)) continue;
        // Enqueued one at a time. `push(...children)` passes each child as a
        // call ARGUMENT, and V8 caps those near 100k — so a slot wider than
        // that throws a native RangeError from inside the counter, before any
        // caller can refuse the document for being too large. The count exists
        // to reject exactly that document.
        for (const child of children) queue.push(child);
      }
    }
  }
  return count;
}

/** Deepest nesting level in the forest; an empty forest is depth 0. */
export function treeDepth(nodes: BlockNode[]): number {
  let deepest = 0;
  const stack: Array<{ node: BlockNode; depth: number }> = nodes.map(node => ({
    node,
    depth: 1,
  }));
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    if (entry.depth > deepest) deepest = entry.depth;
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
        for (const child of children) {
          stack.push({ node: child, depth: entry.depth + 1 });
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
