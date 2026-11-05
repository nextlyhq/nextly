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
 * breakpoint" beside a canvas width — is two facts about one thing, and they
 * drift: a selector that changes which values you edit while the canvas still
 * shows desktop leaves the author editing one tier and looking at another.
 * Deriving removes the state that could drift rather than keeping two in step.
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
import { usableScale, type CanvasZoom } from "./canvas-zoom";

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
    /*
     * `<=`, so among tiers sharing a bound the LAST one wins.
     *
     * Two viewport ids can carry the same `maxWidth` — a stored set written
     * through the API can say so — and the compiler emits both, in order, into
     * one at-rule. Measured: `alpha` then `beta` at 991 produce two
     * declarations in a single `@media (max-width: 991px)` block, so `beta` is
     * what the browser paints. Taking the first would write the author's edit
     * into a tier whose value is then overridden by the one below it, and the
     * control would look correct while nothing changed on screen.
     */
    if (narrowest === undefined || context.maxWidth <= narrowest.maxWidth) {
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
 * The tiers a canvas width can actually select, widest first.
 *
 * ONE per distinct bound. Selecting a tier sets a WIDTH and everything else is
 * derived from it, so two tiers sharing a bound are not two choices: both
 * radios would emit the same number, the match would resolve to one of them,
 * and clicking the other would silently select the first.
 *
 * Among tiers sharing a bound the LAST is kept, because that is the one the
 * browser paints — the compiler emits both into a single at-rule in order, so
 * the later declaration wins. Keeping the first would name a tier whose value
 * is overridden by the one below it, and {@link editedBreakpointAtWidth} would
 * disagree with this list about which tier an edit lands in.
 *
 * Taken from the compiler's contexts rather than the stored definitions, so a
 * definition it declines to emit a bounded context for is not offered: sizing
 * the canvas to a number nothing responds to reads as the feature being broken
 * rather than as the definition being unusable.
 *
 * @experimental
 */
export function offeredTiers(
  set: BreakpointSet | undefined
): Array<{ id: BreakpointId; maxWidth: number }> {
  const byWidth = new Map<number, BreakpointId>();
  for (const context of breakpointContexts(set)) {
    if (context.axis === "container") continue;
    if (!isUsableWidth(context.maxWidth)) continue;
    // Later assignment wins, which is the collapse rule stated above.
    byWidth.set(context.maxWidth, context.id);
  }
  return [...byWidth.entries()]
    .map(([maxWidth, id]) => ({ id, maxWidth }))
    .sort((a, b) => b.maxWidth - a.maxWidth);
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
/**
 * The narrowest canvas width at which the UNCONDITIONAL tier applies.
 *
 * One past the widest bound, because a bounded tier applies at `width <= bound`
 * — so the first width no bounded tier claims is `bound + 1`, and that is where
 * the base rules are what an author is editing.
 *
 * Derived rather than chosen. A conventional desktop number would be a width
 * the site never declared, and the canvas would then simulate a viewport
 * nothing in the document mentions; one past the widest bound is the only width
 * the site's own tiers imply. It is also the SMALLEST such width, which matters
 * because the canvas is scaled to fit: every pixel past it costs the author
 * legibility for nothing.
 *
 * `undefined` when the site bounds no viewport tier at all. Base already
 * applies at every width there, so there is no width to go to — and offering
 * one would size the canvas to a bound the site never declared, which is what
 * the switcher's own tier list refuses to do.
 */
export function baseWidth(set: BreakpointSet | undefined): number | undefined {
  const widest = offeredTiers(set)[0];
  return widest === undefined ? undefined : widest.maxWidth + 1;
}

/**
 * Every tier the breakpoint control can put the canvas at, widest first.
 *
 * The bounded tiers AND the unconditional one, which is offered at the width it
 * applies from. Published as one list because two places need the same answer
 * and they are not the same code: the control builds its options from it, and
 * the host clears a requested width that is not on it — a canvas pinned to a
 * bound the stylesheet no longer has, after an author deletes the tier they
 * selected, has no control on screen to release it.
 *
 * Measured: those two DID disagree. The host compared against the bounded tiers
 * alone while the control had begun offering the unconditional one, so choosing
 * base set a width the host cleared on the very next render — the canvas
 * returned to filling the region, and base stayed uneditable exactly where it
 * had been. Nothing failed; the option simply did nothing.
 */
export function selectableTiers(
  set: BreakpointSet | undefined
): Array<{ id: BreakpointId; maxWidth: number; unconditional?: boolean }> {
  const base = baseWidth(set);
  return [
    ...(base === undefined
      ? []
      : [{ id: BASE_BREAKPOINT, maxWidth: base, unconditional: true }]),
    ...offeredTiers(set),
  ];
}

export function widthForBreakpoint(
  set: BreakpointSet | undefined,
  id: BreakpointId
): number | undefined {
  /*
   * Read from {@link selectableTiers}, not from the contexts directly.
   *
   * The SELECTABLE list rather than the bounded one, because a jump and a
   * choice are the same act reached two ways: the switcher offers the
   * unconditional tier at the width it applies from, and a control whose value
   * came from that tier has to send the canvas to the same place. Answering
   * from the bounded tiers alone returned `undefined` for base and released the
   * canvas to the region — which, wherever the region is narrower than the
   * widest bound, lands on the tier the author was jumping AWAY from.
   *
   * Two ids can carry the same bound, and only one of them is what a canvas at
   * that width is showing: the compiler emits both into one at-rule and the
   * later declaration wins. Answering from the contexts would hand back the
   * bound for the LOSING id too — so a caller sets that width believing it
   * selected `alpha`, and every edit made there is written to `beta`, which is
   * the disagreement between the control and the write that collapsing the
   * choice exists to remove.
   *
   * `undefined` for an id that is not selectable is still the honest answer:
   * there is no width that puts that tier on screen, because another tier owns
   * the bound — or, for a site that bounds nothing, because base already
   * applies at every width and the region is where it belongs.
   */
  return selectableTiers(set).find(tier => tier.id === id)?.maxWidth;
}

/**
 * The narrowest the base breakpoint, Desktop, is previewed at.
 *
 * A fixed width rather than the region's: the region changes as panels open
 * and close, and a preview that followed it would show a different layout for
 * the same device. 1280 is the narrowest window the editor supports.
 */
export const DESKTOP_PREVIEW_WIDTH = 1280;

/**
 * The width the canvas lays a device out at, which the zoom then fits into
 * the room the panels leave.
 *
 * A bounded breakpoint is shown at its own bound, the widest width at which
 * it applies, rather than at some device's width: that is the width whose
 * layout the author is styling. The base is shown at 1280, or one pixel past
 * the widest bound on a site whose widest bound reaches 1280, so the base
 * preview never sits inside a narrower breakpoint.
 *
 * `undefined` for an id the site does not define as a viewport breakpoint,
 * and on a site with no viewport breakpoints at all, where there is nothing
 * to simulate and the canvas fills its region.
 */
export function previewWidth(
  set: BreakpointSet | undefined,
  id: BreakpointId
): number | undefined {
  const tiers = offeredTiers(set);
  if (tiers.length === 0) return undefined;
  if (id === BASE_BREAKPOINT) {
    return Math.max(DESKTOP_PREVIEW_WIDTH, (tiers[0]?.maxWidth ?? 0) + 1);
  }
  return tiers.find(tier => tier.id === id)?.maxWidth;
}

/**
 * The breakpoint an edit goes to, from the device the author chose.
 *
 * The choice is stored as the author left it, so it can name a breakpoint the
 * site has since removed, or a container breakpoint, which is not a device.
 * Either way the edit goes to the base breakpoint: a value written under an
 * id the site does not define as a device would never be drawn.
 */
export function editingBreakpointOf(
  set: BreakpointSet | undefined,
  chosen: string | null
): BreakpointId {
  if (chosen === null || chosen === BASE_BREAKPOINT) return BASE_BREAKPOINT;
  return offeredTiers(set).some(tier => tier.id === chosen)
    ? chosen
    : BASE_BREAKPOINT;
}

/**
 * The device to edit at once the site's breakpoints change from `before` to
 * `after`, given the device the author had chosen.
 *
 * The chosen breakpoint while the site still offers it. Once it is removed,
 * the narrowest device that remains at least as wide as it was, so the author
 * stays as close as the site allows to the layout they were styling, without
 * moving to a narrower one whose styles reach fewer widths. A breakpoint left
 * at exactly the removed one's width is the same layout, and is kept: a set
 * may define two at one bound, where only the later one is offered until the
 * other is removed. The base when nothing as wide remains, which covers every
 * width above the remaining bounds.
 *
 * The removed breakpoint's width is read from `before`, since `after` no
 * longer has it. A chosen id `before` never offered as a device has no width
 * to compare, so it goes to the base, as {@link editingBreakpointOf} sends it.
 *
 * @experimental
 */
export function fallbackBreakpoint(
  before: BreakpointSet | undefined,
  after: BreakpointSet | undefined,
  chosen: string | null
): BreakpointId {
  const kept = editingBreakpointOf(after, chosen);
  if (kept === chosen || chosen === null) return kept;
  const former = offeredTiers(before).find(tier => tier.id === chosen);
  if (former === undefined) return BASE_BREAKPOINT;
  // Widest first, so the last one at least as wide is the narrowest of them.
  const wider = offeredTiers(after).filter(
    tier => tier.maxWidth >= former.maxWidth
  );
  return wider.at(-1)?.id ?? BASE_BREAKPOINT;
}

/** A frame's preview height below 600px wide: a phone held upright. */
const PHONE_PREVIEW_HEIGHT = 844;

/** A frame's preview height from 600px up to below 1024px: a tablet. */
const TABLET_PREVIEW_HEIGHT = 1024;

/** A frame's preview height from 1024px up: a laptop screen. */
const DESKTOP_PREVIEW_HEIGHT = 800;

/**
 * The height of the device a width previews, in three bands: a phone, a
 * tablet, a laptop.
 *
 * The canvas's frame fills its region instead (see {@link frameFillingRegion})
 * and takes this only until the region is measured; a host that wants a
 * frame laid out at the device's own height states this as the frame's.
 *
 * Bands rather than one height per breakpoint, because a site can add its own
 * breakpoints at any width and each still needs a height. The same three
 * bands answer for those: a site-added 700px breakpoint is previewed at a
 * tablet's height, like any other width in that band.
 *
 * @experimental
 */
export function previewHeight(width: number): number {
  if (width < 600) return PHONE_PREVIEW_HEIGHT;
  if (width < 1024) return TABLET_PREVIEW_HEIGHT;
  return DESKTOP_PREVIEW_HEIGHT;
}

/** A width and a height, in CSS pixels. */
export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The scale that fits a whole frame into the region around it.
 *
 * BOTH dimensions, because the frame has a height of its own: fitting only the
 * width leaves a desktop frame taller than a short region, and the bottom of
 * the previewed viewport is then off screen with nothing to say so. The
 * smaller of the two ratios is the one at which the frame fits both ways.
 *
 * Never above 1, for the reason the width-only fit gives: a frame shown larger
 * than life makes every measurement an author takes from the screen wrong in
 * the flattering direction. `1` for a region not yet measured, or one of zero,
 * because a ratio taken from either is infinite or `NaN` and would paint the
 * frame nowhere.
 *
 * @experimental
 */
export function frameFitScale(
  frame: FrameSize,
  region: { readonly width?: number; readonly height?: number }
): number {
  const { width, height } = region;
  if (width === undefined || height === undefined) return 1;
  if (!(width > 0) || !(height > 0)) return 1;
  if (!(frame.width > 0) || !(frame.height > 0)) return 1;
  return Math.min(1, width / frame.width, height / frame.height);
}

/**
 * The frame that fills its region: the scale it is painted at, and the height
 * the page is laid out at so that, painted, the frame is exactly as tall as
 * the region.
 *
 * The canvas is the author's window onto the page, as a browser window is a
 * visitor's: it fills the room the editor gives it at any zoom, and a page
 * taller than that scrolls inside it. So only the WIDTH is fitted, the
 * device's; the height follows the room. `vh` on the page then answers for
 * the window the author is looking through, as it does for a visitor.
 *
 * Never above 1 to fit, for the reason {@link frameFitScale} gives. Until the
 * region is measured, the device's own height at actual size: a frame sized
 * from nothing would be drawn nowhere.
 *
 * @experimental
 */
export function frameFillingRegion(
  width: number,
  region: { readonly width?: number; readonly height?: number } | undefined,
  zoom: CanvasZoom
): { readonly scale: number; readonly height: number } {
  const chosen = zoom.kind === "fixed" ? usableScale(zoom.scale) : null;
  const room = region?.height;
  if (room === undefined || !(room > 0)) {
    const height = previewHeight(width);
    return {
      scale: chosen ?? frameFitScale({ width, height }, region ?? {}),
      height,
    };
  }
  // Fitted by the one rule every fit uses, asked with the region's own height
  // on both sides, so only the width decides.
  const scale =
    chosen ??
    frameFitScale(
      { width, height: room },
      { width: region?.width, height: room }
    );
  return { scale, height: room / scale };
}
