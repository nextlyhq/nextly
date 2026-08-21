/**
 * Whether a control's value was authored here, inherited, or never set.
 *
 * This is the question the has-value dot beside every control exists to answer,
 * and the answer is READ rather than re-derived. `styleOrigin` already decides
 * which recorded declaration a node is showing, having settled tier order, both
 * breakpoint axes, states joining the base rules, refused values, descendant
 * selectors and specificity. Walking the cascade again here would be a second
 * implementation of that, and the two would disagree on exactly the cases that
 * made the first one hard.
 *
 * **Three states, following the affordance Webflow established.** A property
 * nothing set is empty; one set on this node at the breakpoint and state being
 * edited is authored here; anything else is inherited — from a named class, a
 * block type's defaults, the page, or this same node at a wider breakpoint. The
 * distinction is what stops an author editing a class through a control that
 * looks like it belongs to one node.
 *
 * **The inherited answer carries its ORIGIN, not just a colour.** A class origin
 * holds both the id and the slug, so a panel can name the class it came from and
 * offer to open it without looking anything up.
 *
 * @module style-provenance
 */

import {
  styleOrigin,
  type BreakpointId,
  type StyleOrigin,
  type StyleState,
  type StyleSubject,
  type StyleTraceEntry,
} from "@nextlyhq/blocks-engine";

/** What a control's dot reports. */
export type StyleProvenance =
  /** Nothing wrote this property; the browser's own default applies. */
  | { readonly kind: "unset" }
  /** This node's own value, at the state and breakpoint being edited. */
  | { readonly kind: "authored"; readonly entry: StyleTraceEntry }
  /**
   * A value from somewhere else — another tier, or this node at another
   * breakpoint or state. Editing the control writes HERE and takes over.
   */
  | {
      readonly kind: "inherited";
      readonly entry: StyleTraceEntry;
      readonly from: StyleOrigin;
    };

/** Everything needed to place one control's dot. */
export interface StyleProvenanceQuery {
  /** The declarations the compiler wrote, in emission order. */
  readonly trace: readonly StyleTraceEntry[];
  /** The node the control belongs to, and the ancestors whose rules reach it. */
  readonly subject: StyleSubject;
  /**
   * The CSS property, as the trace records it.
   *
   * Taken from the control's own leaf (`StyleLeaf.cssProperty`) rather than from
   * the catalog key: two catalog keys can write one CSS property, and the trace
   * records what was written.
   */
  readonly cssProperty: string;
  /** The state being edited. */
  readonly state: StyleState;
  /** The breakpoint being edited, which is what "authored here" is measured against. */
  readonly breakpoint: BreakpointId;
  /**
   * Every breakpoint live at the width being viewed.
   *
   * Distinct from {@link breakpoint}, and both are needed: the live set decides
   * which declarations are in play at all, while the edited one decides whether
   * the winner among them belongs to this control. An editor simulating a narrow
   * viewport inside a wide window is the ordinary case, so neither can be
   * derived from the other.
   */
  readonly liveBreakpoints: readonly BreakpointId[];
}

/** Whether an entry is this node's own value at the position being edited. */
function isAuthoredHere(
  entry: StyleTraceEntry,
  query: StyleProvenanceQuery
): boolean {
  return (
    entry.origin.kind === "node" &&
    entry.origin.id === query.subject.nodeId &&
    entry.breakpoint === query.breakpoint &&
    entry.state === query.state
  );
}

/**
 * Where the value a control is showing came from.
 *
 * Undefined from `styleOrigin` is a real answer rather than a failure — a
 * property no tier set is one the browser takes from its own defaults, and a
 * control over it is genuinely empty.
 */
export function styleProvenance(query: StyleProvenanceQuery): StyleProvenance {
  const entry = styleOrigin(query.trace, query.subject, {
    property: query.cssProperty,
    state: query.state,
    breakpoints: query.liveBreakpoints,
  });
  if (entry === undefined) return { kind: "unset" };
  if (isAuthoredHere(entry, query)) return { kind: "authored", entry };
  return { kind: "inherited", entry, from: entry.origin };
}
