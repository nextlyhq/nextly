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
  /**
   * The element this node's own box renders as, when the caller knows it.
   *
   * Only the typographic baseline needs it: those rules land on `h1` itself
   * rather than on any class, so nothing else in the subject can tell whether
   * one reaches this node. Optional because the knowledge lives in a block's
   * render — a caller that cannot state it gets a baseline reported as not
   * reaching, which is the quiet answer rather than a guessed one.
   */
  tag?: string;
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

/**
 * What a recorded declaration weighs, as `[reach, classes, types]`.
 *
 * **`reach` comes first because specificity only settles a contest between
 * rules matching the SAME element.** Page settings compile onto the page ROOT,
 * so a block reads them by INHERITANCE — and any rule landing on the block
 * itself beats an inherited value however little it weighs. Measured in a
 * browser: `.nx-pb-page.nx-pb-page { color: A }` at `0-2-0` against
 * `.nx-pb-page :where(.nx-bt-box) { color: B }` at `0-1-0`, the box is B.
 * Ranking those two by specificity picks the page and the page is not what
 * renders.
 *
 * A page rule carrying a DESCENDANT is the exception, and it is a real one:
 * `.page a` lands on the same `a` the node's own `a` rule does, so those two do
 * compete and specificity decides between them.
 *
 * Within one reach, `classes` before `types`, because a type never outranks a
 * class however many of it there are. The default tiers are anchored to a
 * SINGLE page-root class with the rest of the selector inside `:where()`, where
 * a descendant and its pseudo-classes contribute nothing — so a block default's
 * `a:hover` must not count as heavier than a node's own `a`, which is what
 * counting pseudo-classes alone made it.
 *
 * Derived from what the compiler emits rather than parsed out of a selector:
 * the anchor is a property of the ORIGIN, and the two live in one package so
 * they cannot drift.
 */
function weightOf(entry: StyleTraceEntry): readonly [number, number, number] {
  const origin = entry.origin;
  switch (origin.kind) {
    // Anchored to one class, everything else inside `:where()`. A descendant
    // adds nothing, which is the whole point of the wrapper.
    case "element":
    case "blockType":
      return [DIRECT, 1, 0];
    case "page":
      return entry.descendant === undefined
        ? [INHERITED, 0, 0]
        : [DIRECT, ...descendantWeight(entry.descendant, 2)];
    // The doubled root plus the node's or class's own class.
    case "node":
    case "class":
      return [DIRECT, ...descendantWeight(entry.descendant, 3)];
  }
}

/** A value the node reads from an ancestor, which any rule of its own beats. */
const INHERITED = 0;

/** A value from a rule landing on the node's own element. */
const DIRECT = 1;

/**
 * A tier's own classes plus whatever its descendant selector adds.
 *
 * The catalog declares exactly two descendants, `a` and `a:hover`, so this
 * counts one element and its pseudo-classes rather than parsing a selector
 * grammar. A general parser here would be a second model of CSS specificity
 * living outside the compiler that emits it.
 */
function descendantWeight(
  descendant: string | undefined,
  anchorClasses: number
): readonly [number, number] {
  if (descendant === undefined) return [anchorClasses, 0];
  const [element = ""] = descendant.split(":");
  const pseudoClasses = descendant.split(":").length - 1;
  return [anchorClasses + pseudoClasses, element.trim() === "" ? 0 : 1];
}

/** Whether `a` outranks `b`: reach first, then classes, then types. */
function outranks(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): boolean {
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
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
    // The baseline lands on the ELEMENT, so only a node rendering that element
    // is wearing it. A subject that does not state its tag gets `false`: the
    // tag lives in a block's render, and a caller that cannot say is answered
    // quietly rather than told a heading's baseline styles its paragraph.
    case "element":
      return subject.tag !== undefined && origin.tag === subject.tag;
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
  let winningSpecificity: readonly [number, number, number] | undefined;
  for (const entry of trace) {
    if (entry.property !== query.property) continue;
    if (entry.state !== query.state) continue;
    if (!live.has(entry.breakpoint)) continue;
    if (!reachesNode(entry, subject) && !reachesThroughAncestor(entry, subject))
      continue;
    const specificity = weightOf(entry);
    // Later beats earlier only at EQUAL weight, which is the cascade the
    // compiler emits: a tier's own anchor, plus whatever a descendant selector
    // adds outside the weightless wrapper.
    if (
      winningSpecificity !== undefined &&
      outranks(winningSpecificity, specificity)
    )
      continue;
    winner = entry;
    winningSpecificity = specificity;
  }
  return winner;
}
