/**
 * Document limits. Hard caps reject a document outright; the warning ratio
 * lets tooling surface "approaching the limit" before authors hit a wall.
 */
import type { BlockDocument, BlockNode } from "./document";
import { walkForest } from "./forest-walk";

/** Maximum nesting depth of nodes (top-level nodes are depth 1). */
export const MAX_DEPTH = 12;

/** Maximum total nodes in one document. */
export const MAX_NODES = 5000;

/**
 * Maximum entries in one collection of a component's envelope.
 *
 * Its own limit rather than {@link MAX_NODES}, because the envelope is not
 * bounded by the tree it points into: several exposed properties, slots and
 * variants may legitimately address ONE node, so a host configuring a small
 * node cap would otherwise see a valid one-node component refused for exposing
 * two of its props.
 *
 * Generous, because it is a bound on work rather than a design opinion — an
 * author who has designated a thousand editable properties on one component
 * has built something no inspector can present, and every number past that
 * only decides how long a malformed import is walked before it is refused.
 */
export const MAX_ENVELOPE_ENTRIES = 1000;

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

/** Total node count across the forest, slots included. */
export function countNodes(nodes: BlockNode[]): number {
  let count = 0;
  // EVERY entry counts, malformed ones included: the cap exists to reject a
  // document by its real element count, so an array padded with junk must not
  // slip past it.
  walkForest(nodes, () => {
    count += 1;
    return "descend";
  });
  return count;
}

/** Deepest nesting level in the forest; an empty forest is depth 0. */
export function treeDepth(nodes: BlockNode[]): number {
  let deepest = 0;
  walkForest(nodes, entry => {
    if (entry.depth > deepest) deepest = entry.depth;
    return "descend";
  });
  return deepest;
}

/**
 * Serialized size of a document in bytes (UTF-8 of its JSON form — the same
 * bytes that hit storage, so the cap measures what actually gets persisted).
 */
export function documentBytes(doc: BlockDocument): number {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}
