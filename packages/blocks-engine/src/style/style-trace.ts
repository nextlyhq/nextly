// What the compiler wrote, and what made it write each thing.
//
// Once a style value can come from a class, a block type's default, the page, or the node itself,
// an author looking at a control cannot tell whose value they are seeing — and if they cannot
// tell, they change the wrong thing. Every builder that added shared styles had to answer this
// with them.
//
// The answer is RECORDED here rather than derived beside the compiler. Deriving it means two
// implementations of one cascade, and two implementations disagree: the indicator then describes
// a page the browser is not rendering, which is worse than no indicator at all. A trace is
// written by the emitter, from the same declarations it emits, in the same loop — so "what the
// stylesheet says" and "what the trace says" cannot come apart without the emitter itself being
// wrong.
//
// The order of the entries IS the cascade order. Everything the compiler emits sits at one
// specificity and is anchored at the page root, so at equal specificity the later rule wins; the
// array index carries that without a field that could drift from it.
//
// @module style/style-trace

import type { StyleState } from "../document";

/** Which tier emitted a declaration, and which member of that tier. */
export type StyleOrigin =
  /** The page's own settings, on the root everything else is anchored to. */
  | { kind: "page" }
  /** A block type's default look, shared by every node of that type. */
  | { kind: "blockType"; type: string }
  /**
   * The typographic baseline for one element, shared by every `h1` on the page.
   *
   * Distinct from `page` although both are supplied by the host rather than
   * authored: page settings compile onto the page ROOT and reach an element by
   * inheritance, while this compiles onto the element ITSELF. Recorded as
   * `page`, a heading's size looked like a value inherited from the page — a
   * provenance panel then filters it as not landing on the block, and reports a
   * visibly applied size as unset.
   */
  | { kind: "element"; tag: string }
  /**
   * A named class the node applies.
   *
   * Carries the id as well as the slug because a document references a class by id and an author
   * reads its name: an inspector offering to open the class needs the first, and a label needs
   * the second.
   */
  | { kind: "class"; id: string; slug: string }
  /** One node's own values. */
  | { kind: "node"; id: string };

/** One declaration the compiler wrote, and where it came from. */
export interface StyleTraceEntry {
  origin: StyleOrigin;
  /** The CSS property, as written. */
  property: string;
  /** The CSS value, as written. */
  value: string;
  /**
   * The selector this attaches to inside the block, for a property that styles something the
   * block contains rather than the block itself — a link colour reaching `a`, say.
   *
   * Absent for the ordinary case. Present, it also carries the specificity: a declaration on
   * ` a:hover` outranks one on ` a` wherever both match, which order alone does not express.
   */
  descendant?: string;
  /** The stored state this came from. */
  state: StyleState;
  /** The breakpoint context it was emitted under. */
  breakpoint: string;
  /** The at-rule wrapping it, when the breakpoint has one. */
  atRule?: string;
}
