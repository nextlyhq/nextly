// Which recorded declaration a node actually shows.
//
// The trace says what the compiler wrote and in what order. This says which of those entries the
// browser is using for one node, one property, at one width — the question an inspector asks to
// label a control "from the Card class" rather than leaving an author guessing whose value they
// are looking at.
//
// Almost everything that makes this hard was settled by recording rather than re-deriving. The
// trace holds only declarations that were EMITTED, in emission order, so tier order, both
// breakpoint axes, states joining the base rules, a refused value, a refused map, a leaf refused
// inside a composite, a class that lost its name to an earlier one, and two catalog keys writing
// one CSS property are all already answered. None of them can be got wrong here because none of
// them is decided here.
//
// Two things are left, and they are the only two.
//
// SCOPE. An entry was written under a selector, and a selector reaches some elements and not
// others. A node is reached by its own rules, by the classes it applies, by its block type's
// defaults, and by the page — and, for a property that styles something INSIDE a block, by any
// ancestor's rule of the same kind, because `.ancestor a` lands on this node's links directly.
//
// SPECIFICITY. Everything is emitted at one specificity except the descendant selectors, which
// carry whatever pseudo-classes the catalog gave them: a declaration on ` a:hover` outranks one
// on ` a` however early it was written. Order decides only between equals.
//
// @module style/style-origin

import type { StyleState } from "../document";

import type { StyleTraceEntry } from "./style-trace";

/**
 * A node, and the ancestors whose rules can reach into it.
 *
 * The caller holds the document, so it names the node rather than this walking a tree it would
 * have to be handed anyway. `ancestors` is outermost first; an empty list is a root node.
 */
export interface StyleSubject {
  nodeId: string;
  /** The block type, when the node has one the site supplies defaults for. */
  blockType?: string;
  /** The ids of the classes the node applies. Order is irrelevant: the trace already carries it. */
  classIds?: readonly string[];
  /** Outermost first. Only their descendant-selector rules can reach this node. */
  ancestors?: readonly Omit<StyleSubject, "ancestors">[];
}

/** What is being asked about. */
export interface StyleQuery {
  /** The CSS property, as the trace records it — `color`, not the catalog key. */
  property: string;
  state: StyleState;
  /**
   * The breakpoints whose rules are live at the width being viewed.
   *
   * Supplied rather than derived because it is a fact about the viewer, not about the document:
   * an editor simulating a narrow viewport inside a wide window is the normal case, and a page
   * can respond to a viewport and a container at once. Everything else about breakpoints — which
   * of two live rules wins — is already in the trace's order.
   */
  breakpoints: readonly string[];
}

/** How many pseudo-classes a descendant selector carries, which is what it adds to specificity. */
function pseudoClassCount(descendant: string | undefined): number {
  if (descendant === undefined) return 0;
  return descendant.split(":").length - 1;
}

/**
 * Whether an entry's origin reaches this node directly.
 *
 * Directly means the selector lands on the node's own element: its own rules, a class it applies,
 * its block type's defaults, or the page root it sits under.
 */
function reachesNode(entry: StyleTraceEntry, subject: StyleSubject): boolean {
  const origin = entry.origin;
  switch (origin.kind) {
    case "page":
      return true;
    case "node":
      return origin.id === subject.nodeId;
    case "blockType":
      return origin.type === subject.blockType;
    case "class":
      return (subject.classIds ?? []).includes(origin.id);
  }
}

/**
 * Whether an entry's origin reaches this node through an ancestor.
 *
 * Only for a rule with a descendant selector. `.ancestor a` styles the links inside everything the
 * ancestor contains, including this node, and competes with this node's own `a` rules at equal
 * specificity — so it is not inheritance, and treating it as inheritance reports the wrong colour
 * for a link inside a styled parent.
 */
function reachesThroughAncestor(
  entry: StyleTraceEntry,
  subject: StyleSubject
): boolean {
  if (entry.descendant === undefined) return false;
  return (subject.ancestors ?? []).some(ancestor =>
    reachesNode(entry, { ...ancestor, ancestors: [] })
  );
}

/**
 * The entry a node is showing for one property, or `undefined` when nothing wrote it.
 *
 * Undefined is a real answer and not a failure: a property no tier set is one the browser takes
 * from its own defaults, and a control over it is genuinely empty.
 */
export function styleOrigin(
  trace: readonly StyleTraceEntry[],
  subject: StyleSubject,
  query: StyleQuery
): StyleTraceEntry | undefined {
  const live = new Set(query.breakpoints);
  let winner: StyleTraceEntry | undefined;
  let winningSpecificity = -1;
  for (const entry of trace) {
    if (entry.property !== query.property) continue;
    if (entry.state !== query.state) continue;
    if (!live.has(entry.breakpoint)) continue;
    if (!reachesNode(entry, subject) && !reachesThroughAncestor(entry, subject))
      continue;
    const specificity = pseudoClassCount(entry.descendant);
    // Later beats earlier only at equal specificity, which is the cascade the compiler emits for:
    // one class-worth for everything, plus whatever pseudo-classes a descendant selector adds.
    if (specificity < winningSpecificity) continue;
    winner = entry;
    winningSpecificity = specificity;
  }
  return winner;
}
