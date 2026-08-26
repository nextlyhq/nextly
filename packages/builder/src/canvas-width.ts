/**
 * What a canvas of a given width is showing, and which tier an edit lands in.
 *
 * ## The width is the single source of truth
 *
 * There is no second piece of state saying which breakpoint the inspector
 * edits. The canvas owns a width in CSS pixels; the edited tier and the live
 * tiers are both DERIVED from it, so they cannot disagree with each other or
 * with what is on screen.
 *
 * That is not a stylistic preference. The alternative — a stored "current
 * breakpoint" beside a canvas width — is two facts about one thing, and the
 * founder's 2026-08-24 ruling deferred this control precisely because a
 * selector that changes which values you edit while the canvas still shows
 * desktop is confusing. Deriving removes the state that could drift rather
 * than keeping the two in step.
 *
 * Gutenberg reached the same answer from the opposite direction: its device
 * dropdown and its resizable canvas were mutually exclusive surfaces until it
 * unified them by treating canvas width as the source of truth, with the device
 * menu demoted to a way of SETTING a width and the viewport derived from it as
 * a range. An intermediate width then needs no preset to exist.
 *
 * ## Why this reads `maxWidth` and not the emitted query text
 *
 * {@link matchedBreakpoints} evaluates each context's OWN at-rule through a
 * `matches` callback, and its docblock is emphatic that width arithmetic beside
 * it would be a second implementation of the same condition. That warning is
 * about parsing the emitted STRING, which is a second reading of what the
 * compiler wrote.
 *
 * This module does something different: it reads `maxWidth` off the context the
 * compiler produced, which is the same structured field `liveBreakpointsFor`
 * already decides with. The compiler derives its query text from that number,
 * so both are downstream of one value rather than two readings of one string.
 * `agreesWithTheEmittedQuery` in the tests pins them together, so a compiler
 * that changed to `min-width`, to a different unit, or to a half-open bound
 * fails here rather than silently disagreeing.
 *
 * ## The container axis is excluded
 *
 * For the reason {@link liveBreakpointsFor} gives: even at its widest a
 * container context emits `@container (min-width: 0)`, which matches only an
 * element that HAS a query container above it. Whether the selected block does
 * is a fact about the rendered tree that width arithmetic cannot see, so
 * including it would let a container declaration be reported live for a block
 * the browser is applying nothing to — wrong rather than quiet.
 *
 * @module canvas-width
 */

import {
  BASE_BREAKPOINT,
  breakpointContexts,
  type BreakpointId,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";

import { isUsableWidth } from "./breakpoints";

/**
 * The viewport tiers a canvas of this width is applying, widest first.
 *
 * The same question {@link matchedBreakpoints} answers for the browser window,
 * asked of a box whose width the editor owns instead. Under a preview compile
 * the window cannot answer at all — the tiers are container queries and
 * `matchMedia` has nothing to say about an element — which is why the canvas
 * has to answer for itself, and why the panel withholds its provenance
 * indicator until something does.
 *
 * Note the set is read WITHOUT the preview option. That is deliberate and it is
 * the whole point: the preview option decides how the sheet is EMITTED, and
 * this decides what a box of a given width shows. A canvas at 800px shows what
 * a real viewport at 800px would show, and the preview compile exists so that
 * remains true inside a box.
 *
 * @experimental
 */
export function breakpointsAtWidth(
  set: BreakpointSet | undefined,
  width: number | undefined
): BreakpointId[] {
  const contexts = breakpointContexts(set).filter(
    context => context.axis !== "container"
  );
  return contexts
    .filter(context => {
      // The unconditional context applies at every width, which is what makes
      // it the base: it is the only tier that is never a query.
      if (!isUsableWidth(context.maxWidth)) return true;
      /*
       * An unmeasured canvas reports the unconditional context alone rather
       * than guessing.
       *
       * Nothing has been observed yet on the first render, before layout has
       * run — and reporting the widest PRESET there would be a claim about a
       * box nobody has measured. The tier this yields is the honest one, and it
       * is also what the server render produces, so the two agree and React
       * does not discard the subtree.
       */
      if (width === undefined) return false;
      // Desktop-first: the compiler emits `(max-width: Npx)`, which applies at
      // N and below. Inclusive, matching the query rather than approximating it.
      return width <= context.maxWidth;
    })
    .map(context => context.id);
}

/**
 * The tier an edit lands in at this width: the NARROWEST one applying.
 *
 * Narrowest rather than widest, because that is the one whose declaration wins.
 * At 800px on a site defining tablet (991) and mobile (575), both the base and
 * tablet contexts apply and tablet is what the browser paints — so an edit made
 * while looking at 800px must land in tablet, or the author changes a value they
 * cannot see change.
 *
 * Falls back to {@link BASE_BREAKPOINT} rather than to whatever came first: a
 * site that has defined no breakpoints, or a width above every bound, is
 * editing the unconditional tier, and that is a real answer rather than a
 * default standing in for a missing one.
 *
 * @experimental
 */
export function editedBreakpointAtWidth(
  set: BreakpointSet | undefined,
  width: number | undefined
): BreakpointId {
  const contexts = breakpointContexts(set).filter(
    context => context.axis !== "container"
  );
  const live = new Set(breakpointsAtWidth(set, width));
  let narrowest: { id: BreakpointId; maxWidth: number } | undefined;
  for (const context of contexts) {
    if (!live.has(context.id)) continue;
    if (!isUsableWidth(context.maxWidth)) continue;
    if (narrowest === undefined || context.maxWidth < narrowest.maxWidth) {
      narrowest = { id: context.id, maxWidth: context.maxWidth };
    }
  }
  if (narrowest !== undefined) return narrowest.id;
  /*
   * The unconditional context's own id, not the constant, when the set has one.
   *
   * `breakpointContexts` names that context, and a site whose stored set spells
   * the unconditional tier differently would otherwise be told it is editing an
   * id its own document does not use — a write addressed to a tier that is not
   * there.
   */
  const unconditional = contexts.find(
    context => !isUsableWidth(context.maxWidth)
  );
  return unconditional?.id ?? BASE_BREAKPOINT;
}

/**
 * The canvas width that puts a tier on screen, or `undefined` for the widest.
 *
 * The switcher's whole job in one function: choosing a tier SETS a width, and
 * everything else follows from the width. `undefined` means "as wide as the
 * region allows" — the unconditional tier has no upper bound, so pinning it to
 * a number would invent one and make the widest preset narrower than the space
 * available.
 *
 * The tier's own `maxWidth` rather than one pixel below it. The query is
 * `(max-width: Npx)` and therefore inclusive, so N is inside the tier — and it
 * is the width at which the author sees the tier at its roomiest, which is
 * where a layout decision is actually made.
 *
 * @experimental
 */
export function widthForBreakpoint(
  set: BreakpointSet | undefined,
  id: BreakpointId
): number | undefined {
  const context = breakpointContexts(set).find(
    candidate => candidate.axis !== "container" && candidate.id === id
  );
  return isUsableWidth(context?.maxWidth) ? context.maxWidth : undefined;
}
