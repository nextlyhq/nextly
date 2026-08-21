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
  shapeLeaves,
  STYLE_CATALOG,
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
    }
  /**
   * A declaration reached this control, and which control wrote it cannot be
   * told from what the trace records.
   *
   * The trace identifies a declaration by its CSS property and the selector it
   * attached to, and that pair does not always identify a CONTROL: the catalog
   * writes `background-image` from both `background.url` and
   * `backgroundGradient`, on the node itself, with nothing to separate them.
   * With one of the two stored, both controls would otherwise be classified
   * from the same winning entry and the unset one would report as authored.
   *
   * Reported rather than guessed, because a dot that claims a value the control
   * does not hold is worse than one that says it cannot tell. Resolving it needs
   * the catalog property carried in the trace, which is the engine's to record.
   */
  | {
      readonly kind: "ambiguous";
      readonly entry: StyleTraceEntry;
      /** Every catalog property that writes this declaration, this one included. */
      readonly sharedWith: readonly string[];
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
  /**
   * The selector inside the block this control's declaration attaches to, from
   * the control's own leaf (`StyleLeaf.descendant`), and `undefined` for the
   * ordinary case of styling the block itself.
   *
   * Load-bearing, because a CSS property does not identify a control on its
   * own. The catalog writes `color` from THREE properties: `color` on the block,
   * `linkColor` on ` a`, and `linkColorHover` on ` a:hover`. `styleOrigin` reads
   * the descendant for SPECIFICITY and does not filter on it, so a query
   * carrying only the property lets a link rule win the plain text-colour
   * control — reporting an unset control as authored, and all three controls as
   * showing the same value.
   */
  readonly descendant?: string;
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

/**
 * A descendant selector in the one spelling both sides can be compared in.
 *
 * The trace stores the selector as the compiler GROUPED it — `" a"`, with the
 * leading combinator — while `StyleLeaf.descendant` declares `"a"`. Measured:
 * compiling a node with `linkColor` and `linkColorHover` produces trace entries
 * carrying `" a"` and `" a:hover"`. Comparing the two spellings directly
 * matches nothing, so every link-colour control would report unset.
 *
 * Trimmed rather than re-joined with a space, so this does not depend on which
 * separator the compiler happens to use — only that the two differ by
 * surrounding whitespace, which is what a descendant combinator is.
 */
function normalizeDescendant(value: string | undefined): string {
  return value === undefined ? "" : value.trim();
}

/**
 * Every catalog property that writes one CSS property at one descendant.
 *
 * Derived from the catalog rather than listed, so a property added there is
 * covered without an edit here.
 */
function propertiesWriting(
  cssProperty: string,
  descendant: string | undefined
): string[] {
  const names: string[] = [];
  for (const entry of STYLE_CATALOG) {
    for (const leaf of shapeLeaves(entry.shape)) {
      if (leaf.cssProperty !== cssProperty) continue;
      if (
        normalizeDescendant(leaf.descendant) !== normalizeDescendant(descendant)
      ) {
        continue;
      }
      if (!names.includes(entry.property)) names.push(entry.property);
    }
  }
  return names;
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
  // NARROWED before the question is asked, rather than re-ranked afterwards.
  // `styleOrigin` still decides which of the candidates a node is showing —
  // this only removes the declarations that belong to a different control, so
  // nothing here re-implements tier order, breakpoint axes or specificity.
  const wanted = normalizeDescendant(query.descendant);
  const candidates = query.trace.filter(
    entry => normalizeDescendant(entry.descendant) === wanted
  );
  const entry = styleOrigin(candidates, query.subject, {
    property: query.cssProperty,
    state: query.state,
    breakpoints: query.liveBreakpoints,
  });
  if (entry === undefined) return { kind: "unset" };
  // Asked only once a declaration has won: nothing wrote this position is an
  // unambiguous answer whatever else could have written it.
  const sharedWith = propertiesWriting(query.cssProperty, query.descendant);
  if (sharedWith.length > 1) return { kind: "ambiguous", entry, sharedWith };
  if (isAuthoredHere(entry, query)) return { kind: "authored", entry };
  return { kind: "inherited", entry, from: entry.origin };
}
