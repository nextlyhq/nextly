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
  /**
   * Nothing in this document's own cascade wrote this property for this node.
   *
   * NOT the same as "the browser's default applies". `styleOrigin` considers an
   * ancestor's declaration only when it carries a descendant selector, so an
   * inheritable property — `color`, the font properties — set on an ancestor is
   * visibly active on this node and reported here as unset. Modelling CSS
   * inheritance needs to know which properties inherit, which the catalog does
   * not declare, so it belongs to the engine that owns the cascade rather than
   * to a reading of its output.
   */
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
  /**
   * Every state whose rules are matching right now.
   *
   * A fact about the viewer, exactly as {@link liveBreakpoints} is: an element
   * under a pressed pointer matches `:active` AND `:hover`, and a focused one
   * being hovered matches two more. All of their rules apply at once, and
   * because each is wrapped in `:where()` none outranks another — so emission
   * order alone decides, and a winner can come from a state other than the one
   * being edited.
   *
   * Omitted means the state being edited plus base, which is right when the
   * canvas simulates exactly the state under the cursor. A canvas that
   * simulates several should say so, or a control will report a value the
   * browser is not showing.
   */
  readonly liveStates?: readonly StyleState[];
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
 * Whether a PAGE declaration lands on this block at all.
 *
 * `styleOrigin` treats every page-origin entry as reaching every subject, which
 * is right for the question it answers and wrong for this one. The page's own
 * settings compile onto the page ROOT, so a non-inherited property written there
 * — padding, width, a background colour — styles that root element and nothing
 * inside it. Reported unfiltered, a block control shows "Inherited from the
 * page" for a value the browser is not applying to it.
 *
 * A page entry carrying a DESCENDANT selector is the case that genuinely
 * reaches: `.page a` styles the links inside, this block's included, which is
 * the same rule `reachesThroughAncestor` applies to an ancestor's declarations.
 *
 * **What this deliberately gives up.** A property that truly inherits — `color`,
 * the font properties — set on the page IS visibly active on this block, and
 * that case is now reported as unset rather than as coming from the page.
 * Separating it needs to know which properties inherit, which the catalog does
 * not declare; this module's own `unset` docblock already states that limit for
 * an ancestor's declarations and says the knowledge belongs to the engine that
 * owns the cascade. Answering the two cases differently here would be a second,
 * partial model of CSS inheritance in the layer that reads the output.
 *
 * Quiet where it cannot tell, rather than confidently wrong, which is the same
 * judgement `ambiguous` makes one level up.
 */
function landsOnTheBlock(entry: StyleTraceEntry): boolean {
  if (entry.origin.kind !== "page") return true;
  return normalizeDescendant(entry.descendant) !== "";
}

/**
 * Whether a recorded declaration reaches the element this control addresses.
 *
 * Exact equality is too narrow, because a descendant selector carries the
 * pseudo-classes with it: link hover is `a:hover` in the CATALOG rather than a
 * `StyleState`, so a hovered anchor matches both `a:hover` and the plain `a`
 * beside it. A control on `a:hover` with only `a` stored is displaying the `a`
 * rule, and filtering it out reported the browser's default instead.
 *
 * Less-specific only, and never the reverse: an anchor that is NOT hovered does
 * not match `a:hover`, so a plain-link control must not see a hover rule.
 * Which of the two wins is left to `styleOrigin`, whose ranking already counts
 * pseudo-classes as specificity.
 */
function reachesControl(entry: string, query: string): boolean {
  if (entry === query) return true;
  if (entry === "" || query === "") return false;
  const [entryBase] = entry.split(":");
  const [queryBase] = query.split(":");
  return entryBase === queryBase && !entry.includes(":") && query.includes(":");
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

/**
 * Whichever of several winning entries the browser is actually showing.
 *
 * They all reach the node at the same specificity, so the one written last
 * wins. The trace records declarations in emission order, so its index IS that
 * ordering and nothing here re-derives it.
 */
function lastWritten(
  trace: readonly StyleTraceEntry[],
  winners: readonly (StyleTraceEntry | undefined)[]
): StyleTraceEntry | undefined {
  let best: StyleTraceEntry | undefined;
  let bestIndex = -1;
  for (const winner of winners) {
    if (winner === undefined) continue;
    const index = trace.indexOf(winner);
    if (best === undefined || index > bestIndex) {
      best = winner;
      bestIndex = index;
    }
  }
  return best;
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
    entry.state === query.state &&
    // The DESCENDANT too, because a candidate can reach this control without
    // belonging to it: a plain `a` rule is what a hovered link displays, and it
    // is this node's own value at this breakpoint and state — but the control
    // that wrote it is the plain-link one. Calling that authored would offer to
    // reset a value this control never set.
    normalizeDescendant(entry.descendant) ===
      normalizeDescendant(query.descendant)
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
    entry =>
      reachesControl(normalizeDescendant(entry.descendant), wanted) &&
      landsOnTheBlock(entry)
  );
  const ask = (state: StyleState): StyleTraceEntry | undefined =>
    styleOrigin(candidates, query.subject, {
      property: query.cssProperty,
      state,
      breakpoints: query.liveBreakpoints,
    });
  // An interaction state and the base state are asked SEPARATELY, because
  // `styleOrigin` ranks within one state — and then ranked against each other
  // here, because the browser does not keep them apart. A state selector is
  // wrapped in `:where()`, which adds NO specificity, so a base rule emitted
  // later beats an earlier interaction rule: measured, a class's hover colour
  // followed by the node's base colour leaves the node's base colour showing
  // while hovered. Preferring any interaction winner would report a value the
  // browser is not displaying.
  //
  // Ranked by position in the trace, which is emission order — the same thing
  // the cascade is settling — rather than by a second idea of tier order.
  // Every state matching right now, base included: base always matches, and the
  // state being edited is the one the canvas is simulating.
  const live = new Set<StyleState>([
    ...(query.liveStates ?? []),
    query.state,
    "base",
  ]);
  const winner = lastWritten(
    candidates,
    [...live].map(state => ask(state))
  );
  if (winner === undefined) return { kind: "unset" };
  // Asked only once a declaration has won: nothing wrote this position is an
  // unambiguous answer whatever else could have written it.
  const sharedWith = propertiesWriting(query.cssProperty, query.descendant);
  if (sharedWith.length > 1) {
    return { kind: "ambiguous", entry: winner, sharedWith };
  }
  if (isAuthoredHere(winner, query)) return { kind: "authored", entry: winner };
  return { kind: "inherited", entry: winner, from: winner.origin };
}
