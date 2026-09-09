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
 * Maximum levels of component nesting a resolved tree may reach.
 *
 * Separate from {@link MAX_DEPTH}, and neither bounds the other. `MAX_DEPTH`
 * limits one STORED document; an instance is a single node there whatever its
 * definition holds, so a page at depth 1 can resolve to a tree of any depth.
 * This is the cap on that expansion.
 *
 * Small, because the growth is multiplicative rather than additive: every level
 * can expand one node into a whole definition, so depth is the exponent on how
 * much work one page costs. It is not a cap on how much a designer may
 * compose — a header made of a nav made of a button is three, and past a
 * handful nobody can predict what editing a definition will change.
 *
 * A document that exceeds it fails PER INSTANCE. The instance that would cross
 * the line is left unresolved and the rest of the page renders, because the
 * alternative — refusing the page — hands a visitor a blank screen for a
 * problem in one region of it. Storyblok truncates at depth two and says
 * nothing; the truncation is the same, the report is the difference.
 */
export const MAX_COMPOSED_DEPTH = 5;

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

/**
 * How many entries a whole-forest reader may visit before it refuses.
 *
 * A machine limit like `MAX_WALKABLE_DEPTH` in `ops.ts`, not a product one:
 * {@link MAX_NODES} is a rule a site may raise, and this is the point past
 * which reading the forest at all stops being affordable whatever any site
 * says. Two hundred times the default node cap, so it only ever fires on
 * forests no product setting would have allowed.
 *
 * It exists because entries are not bounded by OBJECTS. `walkForest`
 * deliberately revisits a node object reached under two different parents —
 * one object placed in two slots is two elements of the document, and counting
 * it once would report half a real size and pass a cap the document exceeds.
 * That is right for a count and it makes the walk exponential in depth for a
 * forest whose branches share objects: measured on this module's own helpers, a
 * chain of 21 distinct objects each holding the next twice walks 2,097,151
 * entries, and every further object doubles it.
 *
 * A stored document can never be such a forest, because `JSON.parse` produces
 * fresh objects and cannot express sharing. One built in memory by code can be,
 * and these readers decide whether a document may be stored at all — so the
 * unbounded version failed in the worst possible place.
 */
export const MAX_WALKABLE_ENTRIES = 1_000_000;

/**
 * A forest whose entries outrun {@link MAX_WALKABLE_ENTRIES}.
 *
 * Thrown rather than answered around, because every honest answer here is a
 * refusal: a count taken from a walk that stopped early is a PARTIAL one, and
 * returning it as a whole number is a bound that fails in the passing
 * direction — the document reads as smaller than it is and passes the very cap
 * this module exists to enforce.
 *
 * Named so a caller can tell it from a defect in its own input handling. The
 * `nodes` a caller holds are almost never the cause; a node object reached
 * under more than one parent is.
 */
export class ForestTooLargeError extends Error {
  constructor(subject: string) {
    super(
      `${subject} reaches more than ${String(MAX_WALKABLE_ENTRIES)} entries ` +
        `and cannot be measured: past that the walk is not affordable. A ` +
        `forest this large for its object count holds a node placed under ` +
        `more than one parent, which multiplies entries at every level.`
    );
    this.name = "ForestTooLargeError";
  }
}

/**
 * Visit the forest, refusing rather than answering from a partial walk.
 *
 * The one place the bound is applied, so the three readers below cannot drift
 * on where it sits or on what happens when it is reached.
 */
function walkBounded(
  nodes: BlockNode[],
  subject: string,
  onEntry: (depth: number) => void
): void {
  let seen = 0;
  let spent = false;
  walkForest(nodes, entry => {
    seen += 1;
    if (seen > MAX_WALKABLE_ENTRIES) {
      spent = true;
      return "stop";
    }
    onEntry(entry.depth);
    return "descend";
  });
  if (spent) throw new ForestTooLargeError(subject);
}

/** Total node count across the forest, slots included. */
export function countNodes(nodes: BlockNode[]): number {
  let count = 0;
  // EVERY entry counts, malformed ones included: the cap exists to reject a
  // document by its real element count, so an array padded with junk must not
  // slip past it.
  walkBounded(nodes, "this forest", () => {
    count += 1;
  });
  return count;
}

/** Deepest nesting level in the forest; an empty forest is depth 0. */
export function treeDepth(nodes: BlockNode[]): number {
  let deepest = 0;
  walkBounded(nodes, "this forest", depth => {
    if (depth > deepest) deepest = depth;
  });
  return deepest;
}

/**
 * Serialized size of a document in bytes (UTF-8 of its JSON form — the same
 * bytes that hit storage, so the cap measures what actually gets persisted).
 *
 * The forest is measured FIRST, and this is not belt-and-braces. `JSON.stringify`
 * expands a shared node object into a separate copy per path that reaches it,
 * so the string it builds grows with ENTRIES rather than with objects — and it
 * does not degrade gracefully. Measured on this module's own helpers: 21 shared
 * objects produce 132 MB, and 23 raise `RangeError: Invalid string length`
 * from a document that is a few kilobytes in memory.
 *
 * That error is the reason the guard runs before the serialization rather than
 * around it. A native `RangeError` escaping here names a string length, which
 * says nothing about the document and cannot be acted on; it also arrives from
 * the one function whose whole job is to decide whether a document may be
 * stored, so the failure lands where a caller is least able to interpret it.
 */
export function documentBytes(doc: BlockDocument): number {
  // Guarded at RUNTIME although the type says `BlockNode[]`, because a stored
  // document arrives unvalidated and `walkForest` is written for exactly that.
  // A document whose `nodes` is not a list has nothing to measure and is left
  // to the serializer, which reports its own shape complaint.
  const nodes = doc.nodes;
  if (Array.isArray(nodes)) countNodes(nodes);
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}
