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
  const stack: BlockNode[] = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    count++;
    if (node.slots) {
      for (const children of Object.values(node.slots)) stack.push(...children);
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
    if (entry.node.slots) {
      for (const children of Object.values(entry.node.slots)) {
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
