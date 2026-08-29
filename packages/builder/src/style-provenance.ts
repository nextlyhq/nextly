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
  breakpointContexts,
  outranksEntry,
  type BreakpointAxis,
  type BreakpointId,
  type BreakpointSet,
  type StyleOrigin,
  type StyleState,
  type StyleSubject,
  type StyleTraceEntry,
} from "@nextlyhq/blocks-engine";

import { isUsableWidth } from "./breakpoints";
import { offeredTiers } from "./canvas-width";

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

/*
 * The typographic baseline is deliberately NOT part of the case above. It does
 * land on the block — `:where(h1)` styles the heading itself rather than the
 * page root — so it needs no descendant to reach one, and `styleOrigin` has
 * already refused it for any subject whose element does not match.
 *
 * The subject learns its tag from the CANVAS — `renderedTagOf` reads the
 * element carrying the node's id — so a heading reports its size as coming from
 * the baseline while `core/rich-text` does not: that block's own root is a
 * `div` with its headings inside, and the baseline genuinely does not style its
 * box. A host that supplies no canvas states no tag and gets the refusal, which
 * is the quiet answer rather than a guessed one.
 */

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
export function propertiesWriting(
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
    /*
     * WEIGHT before source order, which is the order the cascade itself applies
     * them in — and `styleOrigin` already ranks this way WITHIN a state. Across
     * states it cannot, because it is asked once per state and each answer is a
     * separate winner, so the comparison lands here.
     *
     * Position alone is wrong wherever the states disagree on weight. A state's
     * rules are wrapped in `:where()`, which contributes NOTHING, so an earlier
     * `.card a:hover` outranks a later `:where(:hover) a` however far apart they
     * were emitted — and picking the later one names a declaration the browser
     * is not showing.
     *
     * Ranked THROUGH the engine's comparator rather than by counting
     * pseudo-classes here. That count was the same answer only while every tier
     * carried one class-worth of prefix. A default is now anchored to a single
     * page-root class with its descendant inside `:where()`, so its ` a:hover`
     * weighs `0-1-0` against a node's ` a` at `0-3-1` — counting names the
     * default while the browser shows the node. One weighting, owned beside the
     * compiler that emits the selectors it describes.
     */
    if (best !== undefined) {
      // The standing answer weighs more, so nothing here can displace it.
      if (outranksEntry(best, winner)) continue;
      // Equal weight, and this one was written first. Source order decides.
      if (!outranksEntry(winner, best) && index < bestIndex) continue;
    }
    best = winner;
    bestIndex = index;
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
  /*
   * A SUPPLIED set is authoritative. The field's own contract says omitting it
   * means the edited state plus base — so adding the edited state back when a
   * caller did state one contradicts the answer they gave: a canvas simulating
   * only `base` while the panel edits `hover` would have a hover declaration
   * reported as the visible winner, which is exactly the case the field exists
   * to let a host rule out.
   *
   * `base` is added either way because base rules are not state-gated and match
   * whatever else is.
   */
  const live = new Set<StyleState>([
    ...(query.liveStates ?? [query.state]),
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

/** Where a value a control is showing was authored, in breakpoint terms. */
export interface BreakpointSource {
  /** The breakpoint's own id, as the trace records it. */
  readonly breakpoint: BreakpointId;
  /**
   * What to call it in front of an author.
   *
   * The stored definition's label, never the id: an id is an addressing detail
   * a site is free to spell `bp_2`, and putting it in front of an author at the
   * one moment the control is explaining itself is the storage layer leaking.
   * Falls back to the id only when no definition carries that bound, where
   * there is no honest name to use instead.
   */
  readonly label: string;
  /**
   * Which axis it belongs to.
   *
   * Carried because a breakpoint NAMED without its axis is ambiguous whenever a
   * site defines both: `breakpointContexts` emits over viewport and container
   * separately, a container context emits a query even at its widest, and
   * container is the axis an author is least likely to be holding in mind. A
   * badge saying "Tablet" when two different tiers could be meant is a label
   * that reads as precise and is not.
   */
  readonly axis: BreakpointAxis;
  /**
   * Whether a canvas can actually be taken to this tier.
   *
   * Two ids can carry one bound, and only the tier that WINS is offered as a
   * choice — but a declaration stored under the loser can still be what a
   * control is showing, and would otherwise earn a "go to" that cannot be
   * honoured: the width lookup answers `undefined` for it, which a host reads
   * as the unconditional tier and releases the canvas instead. Naming the tier
   * is still right; offering to travel to it is not.
   *
   * The unconditional tier IS selectable: releasing the canvas is how it is
   * shown, so `undefined` means something there.
   */
  readonly selectable: boolean;
}

/**
 * What a control's breakpoint badge reports, beside the origin dot.
 *
 * The dot answers WHICH TIER a value came from — this node, a class, the block
 * type, the page. This answers the breakpoint DIMENSION of the same question,
 * which the dot cannot: `StyleOrigin` records only the tier, so "from a class"
 * and "from this node at desktop" arrive as the same `node`/`class` answer with
 * nothing to separate them, and they are the two an author most needs told
 * apart because the next action differs. One is "go and change it there", the
 * other is "override it here".
 */
export type BreakpointBadge =
  /**
   * Nothing to say about breakpoints.
   *
   * The control is unset, or its value came from another TIER rather than
   * another breakpoint, or the declaration cannot be attributed to one control
   * at all. Ambiguous is deliberately included: a badge offering to reset a
   * declaration two controls could have written would clear one the author was
   * not looking at.
   */
  | { readonly kind: "none" }
  /**
   * Authored at the breakpoint being edited, so clearing it here is meaningful.
   *
   * `revealed` is what would then show through — the value the cascade falls
   * back to once this one is gone. Absent when nothing would: the control
   * becomes unset.
   *
   * Named rather than assumed to be the base tier. In a desktop-first model
   * values flow from wider to narrower, and a chain can hold values at several
   * breakpoints, so what a reset reveals is whatever the next one holding a
   * value is.
   */
  | { readonly kind: "authored"; readonly revealed?: BreakpointSource }
  /**
   * The value on screen was authored by THIS NODE at another breakpoint.
   *
   * The case the badge exists for, and the one the origin dot reports as a bare
   * `node` origin indistinguishable from a value set right here. Editing the
   * control writes at the edited breakpoint and takes over from this one.
   */
  | { readonly kind: "inherited"; readonly source: BreakpointSource };

/**
 * Resolve a breakpoint id to something an author can be shown.
 *
 * Exported because it is the ONE answer to "what is this breakpoint called" —
 * the panel's own label helper reads it rather than repeating the lookup, which
 * would be two matchers for a rule that has a subtlety in it (the survivor is
 * matched on the BOUND as well as the id) and two places to lose it.
 *
 * The AXIS and the bound come from `breakpointContexts`, which is the reader
 * that decides what a site's breakpoints are for the sheet; the label is then
 * matched on the bound as well as the id, because among definitions sharing an
 * id the compiler keeps one and a lookup by id alone can name the survivor
 * after a row the sheet discarded.
 */
export function breakpointSource(
  breakpoint: BreakpointId,
  breakpoints: BreakpointSet | undefined
): BreakpointSource | undefined {
  const context = breakpointContexts(breakpoints).find(
    candidate => candidate.id === breakpoint
  );
  /*
   * No context, or one that does not say which axis it belongs to, yields no
   * badge at all.
   *
   * `BreakpointContext.axis` is optional, and a badge is a claim about which
   * axis a value came from — the one thing the research says a breakpoint name
   * cannot be shown without. Defaulting it to the viewport would put a
   * confident label on the axis an author is least likely to be holding in
   * mind, which is the case the axis is carried for.
   */
  if (context?.axis === undefined) return undefined;
  const defs =
    context.axis === "container"
      ? breakpoints?.container
      : breakpoints?.viewport;
  const named = (defs ?? []).find(
    def => def?.id === breakpoint && def?.maxWidth === context.maxWidth
  );
  return {
    breakpoint,
    label: named?.label ?? breakpoint,
    axis: context.axis,
    /*
     * Unbounded is the unconditional tier and always reachable. A bounded tier
     * is reachable only if it is the one `offeredTiers` kept for that width —
     * the same list the switcher builds its options from, so "a tier a canvas
     * can be taken to" has one definition rather than two.
     */
    /*
     * The unconditional VIEWPORT tier is reachable — releasing the canvas is
     * how it is shown. An unbounded CONTAINER definition is not: it has no
     * `maxWidth` either, but `offeredTiers` and `widthForBreakpoint` exclude
     * the container axis entirely, so a jump would hand the host `undefined`
     * and release the canvas as though base had been chosen. Sizing a canvas
     * cannot put an element's own query container at a width, whatever the
     * definition looks like.
     */
    selectable:
      context.axis !== "container" &&
      (!isUsableWidth(context.maxWidth) ||
        offeredTiers(breakpoints).some(tier => tier.id === breakpoint)),
  };
}

/**
 * The badge for a value that won from somewhere other than the edited address.
 *
 * Its own function because the question is one word — is this THIS control at
 * another breakpoint? — and the answer needs the whole address checked.
 * `styleOrigin` deliberately returns declarations from an enclosing node, from
 * another state, and from a less specific sibling control, so a bare `node`
 * origin proves none of what the action promises.
 */
function inheritedBadge(
  query: StyleProvenanceQuery,
  provenance: Extract<StyleProvenance, { kind: "inherited" }>,
  breakpoints: BreakpointSet | undefined
): BreakpointBadge {
  const { from, entry } = provenance;
  const sameAddress =
    from.kind === "node" &&
    from.id === query.subject.nodeId &&
    entry.state === query.state &&
    normalizeDescendant(entry.descendant) ===
      normalizeDescendant(query.descendant);
  if (!sameAddress) return { kind: "none" };
  if (entry.breakpoint === query.breakpoint) return { kind: "none" };
  const source = breakpointSource(entry.breakpoint, breakpoints);
  return source === undefined
    ? { kind: "none" }
    : { kind: "inherited", source };
}

/**
 * The breakpoint badge for one control.
 *
 * Derived from {@link styleProvenance} rather than beside it, so there is one
 * answer to "what is this control showing" and this adds only the breakpoint
 * reading of it. A second ranking here would be a second cascade, and the two
 * would disagree first at exactly the boundaries the trace exists to settle.
 *
 * What a reset REVEALS is computed by asking the same question again with the
 * edited breakpoint removed from the live set — the engine's own ranking, run
 * once more over an already-filtered trace, rather than a hand-rolled "next
 * wider" that would have to re-derive tier order, both axes and specificity.
 * Only reached for a control that is authored here, which is the small minority
 * of them, so the cost is bounded by what an author has actually set.
 */
export function breakpointBadge(
  query: StyleProvenanceQuery,
  /**
   * What {@link styleProvenance} already answered for this control.
   *
   * Taken rather than recomputed, because the badge is the breakpoint READING
   * of a provenance and not a second opinion about it. A caller placing a dot
   * has one in hand, and computing another here would be a second ranking of
   * the same trace — the two would first disagree at exactly the boundaries the
   * trace exists to settle.
   */
  provenance: StyleProvenance,
  breakpoints: BreakpointSet | undefined
): BreakpointBadge {
  if (provenance.kind === "unset" || provenance.kind === "ambiguous") {
    return { kind: "none" };
  }
  if (provenance.kind === "inherited") {
    return inheritedBadge(query, provenance, breakpoints);
  }
  /*
   * Authored here. What a reset would reveal is whatever wins once the
   * declarations the reset ACTUALLY CLEARS are gone.
   *
   * Simulated by removing those declarations from the trace, not by removing
   * the breakpoint from the live set. A reset clears one address — this node,
   * this state, this breakpoint, this control's property and path — and leaves
   * every other origin at that breakpoint standing. Dropping the whole
   * breakpoint discards a class, block-type or page declaration that would
   * survive, so a node value overriding a class value at Mobile was described
   * as "leaving it unset" while the class value is what actually appears.
   *
   * The descendant is matched too: a rule on a more specific selector reaches
   * this control without being written BY it, so this control's reset does not
   * remove it.
   */
  const cleared = query.trace.filter(
    entry =>
      !(
        entry.origin.kind === "node" &&
        entry.origin.id === query.subject.nodeId &&
        entry.state === query.state &&
        entry.breakpoint === query.breakpoint &&
        entry.property === query.cssProperty &&
        normalizeDescendant(entry.descendant) ===
          normalizeDescendant(query.descendant)
      )
  );
  const revealedBy = styleProvenance({ ...query, trace: cleared });
  if (revealedBy.kind === "unset" || revealedBy.kind === "ambiguous") {
    return { kind: "authored" };
  }
  const source = breakpointSource(revealedBy.entry.breakpoint, breakpoints);
  return source === undefined
    ? { kind: "authored" }
    : { kind: "authored", revealed: source };
}
