"use client";

/**
 * The editing canvas — the authored page, drawn by the same renderer that draws
 * the published one.
 *
 * It delegates every pixel to `PageRenderer` and adds only the things editing
 * needs on top: which node is selected, which is under the pointer, and the
 * outlines that say so. Nothing here knows how a heading or a gallery draws
 * itself, and that is the property worth protecting — a canvas with its own
 * rendering path is a second implementation of "what does this page look like",
 * and the two drift in the direction nobody tests, so the preview stops matching
 * the page while both look correct in isolation.
 *
 * That mattered concretely: the editor this replaces DID have its own compiler
 * and its own block set, and the two disagreed about the token namespace, about
 * where a page's nodes live, and about what a binding is. A faithful preview was
 * unreachable from there by construction, not by neglect.
 *
 * **`siteStyles` is a required prop, deliberately.** `PageRenderer` takes it as
 * optional because a standalone consumer may legitimately emit no site sheet,
 * but for the canvas an omitted sheet is never correct: the design tokens, the
 * block-type defaults and the named classes all live in it, so a canvas without
 * it shows a page whose grid, clipping and colours are missing exactly where the
 * published page has them. Making it optional here would let a faithful-looking
 * preview be wrong in a way no assertion catches, so the type demands it and the
 * host has to supply what the route supplies.
 *
 * @module canvas
 */

import {
  PAGE_ROOT_CLASS,
  previewContainerName,
  previewStateClass,
  statePropagatesToAncestors,
  STYLE_STATES,
  type BlockDocument,
  type BreakpointSet,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import {
  NODE_ID_ATTRIBUTE,
  PageRenderer,
  previewContainerStyle,
  sharedStyleInputs,
} from "@nextlyhq/blocks-react";
import type { PageRendererProps } from "@nextlyhq/blocks-react";
import { cn } from "@nextlyhq/ui/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CanvasDragHandlers } from "./canvas-drag";
import { offeredTiers } from "./canvas-width";
import { FIT_ZOOM, usableScale, type CanvasZoom } from "./canvas-zoom";
import { observeRenderedTree } from "./rendered-tree";
import { selectionModeFor, type SelectionMode } from "./selection";
import { CANVAS_ROOT_CLASS } from "./shell-state";

/**
 * The class marking the canvas root, and the boundary the hit-test stops at.
 *
 * Declared in `shell-state.ts` beside the other markers `builder-chrome.css`
 * spells out literally, and re-exported here because this is where a reader
 * looks for the canvas's own marker. See {@link nodeIdFromEvent} for the walk
 * that needs it as an upper bound.
 */
export { CANVAS_ROOT_CLASS };

/**
 * Marks the selected block's own element.
 *
 * Boolean by presence rather than carrying the id: the element already states
 * its id through `NODE_ID_ATTRIBUTE`, and repeating it here would be a second
 * copy that a partial re-mark could leave disagreeing with the first.
 *
 * Exported because a host styling the canvas, and a test asserting what is
 * selected, both need to name it — and a string typed twice is a contract with
 * no compiler behind it.
 */
export const SELECTED_ATTRIBUTE = "data-nx-selected";

/**
 * Marks editor chrome drawn over the page, which is not part of the page.
 *
 * A click on the canvas background CLEARS the selection, and the overlay sits
 * inside the canvas root — so without this a press on any control drawn over
 * the page resolves to "no node" and deselects the very block that control
 * acts on. The floating toolbar would run its action and then watch itself
 * disappear.
 *
 * An attribute rather than each overlay calling `stopPropagation`: the rule
 * belongs to what chrome IS, and the version where every new overlay has to
 * remember it is the version where the next one does not. The drop indicator
 * needs no marker only because it takes no pointer events at all.
 */
export const CHROME_ATTRIBUTE = "data-nx-chrome";

/** Whether an event started inside editor chrome rather than inside the page. */
/**
 * The block a context gesture is aimed at, or `null` when it is aimed at
 * nothing a block menu could act on.
 *
 * Published because a context menu can be opened TWO ways and they arrive by
 * different events. A secondary click arrives as `contextmenu`, which the
 * canvas sees; a touch or pen long-press is opened by Radix from its own timer
 * on `pointerdown`, and never produces a `contextmenu` event at all. A menu
 * that filtered one path and not the other would offer a block's verbs for a
 * press aimed at chrome, or — worse — offer the PREVIOUS selection's verbs,
 * with Delete among them, for a press on a block that was never selected.
 *
 * So the decision lives here once and both callers ask it, rather than each
 * spelling out three rejections and drifting.
 */
export function contextMenuTargetOf(
  target: EventTarget | null,
  root: Element
): string | null {
  if (isEditableTarget(target) || isChrome(target)) return null;
  if (!(target instanceof Element)) return null;
  const owner = target.closest(`[${NODE_ID_ATTRIBUTE}]`);
  if (owner === null) return null;
  /*
   * Owned by THIS canvas, not merely by A canvas.
   *
   * `nodeIdFromEvent` asks the weaker question — its own comment claims this
   * one, and it checks only that some canvas is an ancestor. That is enough
   * for selection, where a foreign id is ignored and nothing happens. It is
   * not enough here: a canvas rendered inside a block of another canvas sends
   * its events up through the outer one, which would then let a menu open
   * while the outer selection stayed where it was — and its verbs would act on
   * a block nobody was pointing at.
   */
  if (owner.closest(`.${CANVAS_ROOT_CLASS}`) !== root) return null;
  return owner.getAttribute(NODE_ID_ATTRIBUTE);
}

/**
 * Whether the gesture landed in text the author is editing.
 *
 * Asked apart from {@link isChrome} because the answer is the same and the
 * reason is not: chrome is not the page, while this IS the page and is being
 * typed into. The browser's own menu carries spelling, selection and clipboard
 * for a caret, and none of that has a replacement here — taking it away mid
 * sentence to offer "Move up" is a straight loss.
 *
 * `contenteditable="false"` is excluded explicitly: it marks a region the
 * editor has deliberately made uneditable INSIDE an editable one, which is a
 * block again rather than text.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest("[contenteditable]");
  return (
    editable !== null && editable.getAttribute("contenteditable") !== "false"
  );
}

function isChrome(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(`[${CHROME_ATTRIBUTE}]`) !== null
  );
}

/**
 * How a pointer event on the canvas resolves to a node id, or to nothing.
 *
 * `closest` rather than reading the target directly: a click lands on whatever
 * leaf is under the pointer — a `<span>` inside a heading, an `<img>` inside a
 * card — and the node that owns it is an ancestor. Reading the target alone
 * selects nothing for every block that renders more than one element, which is
 * most of them.
 *
 * The attribute name comes from `@nextlyhq/blocks-react` rather than being
 * spelled here. The renderer writes it and this reads it, so two spellings
 * would be two declarations of one name, and the day it moves the hit-testing
 * would resolve nothing while every test that hard-coded it still passed.
 *
 * **Bounded at the canvas root, which is not a detail.** The renderer applies
 * the attribute by cloning the block's root element and returns the output
 * untouched when it is not a single host element — so a block rendering a
 * fragment or a component carries none. An unbounded `closest` then walks past
 * it to the nearest ANCESTOR that has one, and returns that node's id: a
 * confidently WRONG selection rather than a missing one.
 *
 * The two failures are not equally bad. A miss is visible immediately — the
 * author clicks and nothing happens. A wrong hit selects a container while the
 * author believes they selected the child inside it, and every edit afterwards
 * lands on the wrong node with nothing to indicate it.
 */
export function nodeIdFromEvent(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const owner = target.closest(`[${NODE_ID_ATTRIBUTE}]`);
  if (owner === null) return null;
  // Inside THIS canvas, not merely inside something carrying the attribute. A
  // canvas rendered within another rendered page would otherwise resolve a
  // click to the outer page's node.
  if (owner.closest(`.${CANVAS_ROOT_CLASS}`) === null) return null;
  return owner.getAttribute(NODE_ID_ATTRIBUTE);
}

/**
 * The element a node id was rendered as, or `null` when it is not on screen.
 *
 * The inverse of {@link nodeIdFromEvent}, and beside it because the two are one
 * mapping read in two directions — separated, they become two answers to what a
 * node id means in the DOM.
 *
 * Ids are COMPARED rather than interpolated into a selector. A node id reaches
 * here from stored data, so any character CSS treats specially makes
 * `querySelector` either throw or match something else entirely.
 *
 * Deliberately not the {@link SELECTED_ATTRIBUTE} marker. That marker is applied
 * in a passive effect, so on the render where the selection changes it is still
 * on the previously selected element, and any chrome measuring in a layout
 * effect would spend a frame measuring the wrong block.
 */
export function nodeElement(root: HTMLElement, id: string): Element | null {
  let found: Element | null = null;
  // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
  // that declares its iterator, and this package compiles without one.
  root.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
    if (found === null && element.getAttribute(NODE_ID_ATTRIBUTE) === id) {
      found = element;
    }
  });
  return found;
}

/**
 * Every element the renderer marked as a node, in document order.
 *
 * Beside {@link nodeElement} because both answer from the same marker, and a
 * caller that needs all of them should not walk the tree with its own selector.
 *
 * Chrome drawn INSIDE the canvas root carries no node marker, so it is excluded
 * by construction rather than by a filter that would have to be kept in step
 * with whatever chrome arrives next.
 */
export function nodeElements(root: HTMLElement): readonly Element[] {
  const found: Element[] = [];
  // `forEach` for the reason given in `nodeElement`: a `NodeList` is only
  // iterable under a lib this package does not compile with.
  root.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
    found.push(element);
  });
  return found;
}

/**
 * The observed entry's inline size, across the shapes `ResizeObserver` has had.
 *
 * `contentBoxSize` was specified as a SEQUENCE, and Firefox shipped it as a
 * single object first; both shapes are still reachable, and polyfills predating
 * it expose only `contentRect`. Read as an array alone, every one of those
 * reports `undefined` on every notification — and the caller cannot tell that
 * from "nothing has been measured yet", so the canvas would apply tablet rules
 * while the inspector stayed on the base tier and the author's edits landed in
 * a breakpoint they were not looking at.
 *
 * `contentRect` is the right fallback rather than a lesser one: like
 * `contentBoxSize` it is a LAYOUT size, so the editor's canvas zoom does not
 * scale it — which `getBoundingClientRect()` would, reporting what a reader
 * sees rather than what a container query resolves against. `builder-shell.tsx`
 * measures on the same property for the same reason. It carries `width` rather
 * than an inline size, so the two agree only in a horizontal writing mode; the
 * admin is one, and the sequence shape above is preferred wherever it exists.
 */
function inlineSizeOf(entry: ResizeObserverEntry): number | undefined {
  const box: unknown = entry.contentBoxSize;
  const first: unknown = Array.isArray(box) ? box[0] : box;
  const inline = (first as ResizeObserverSize | undefined)?.inlineSize;
  if (typeof inline === "number") return inline;
  const width = entry.contentRect?.width;
  return typeof width === "number" ? width : undefined;
}

/**
 * Report a box's real inline size to its owner whenever it changes.
 *
 * `ResizeObserver` rather than a resize listener on the window: the box changes
 * width when the inspector opens, when a rail panel is toggled and when the
 * pane is dragged, none of which resize the window. A window listener would
 * report the same number across all three.
 */
function useReportedInlineWidth(
  box: React.RefObject<HTMLElement | null>,
  report: ((width: number | undefined) => void) | undefined
): void {
  /*
   * The reporter is held in a ref, and the effect does NOT depend on it.
   *
   * A host writing `onMeasured={w => setWidth(w)}` inline hands a new function
   * on every render. Depended on directly, every real measurement would update
   * the parent, produce a new identity, tear the observer down — reporting
   * `undefined` from the cleanup, as if the canvas had gone — and build a new
   * one that immediately reports the real width again. The derived tier
   * oscillates and the observer churn can sustain a render loop, on a host that
   * did nothing wrong.
   *
   * So the effect keys on whether a reporter EXISTS, which is the only part of
   * it that changes what the observer should do.
   */
  const latest = useRef(report);
  useEffect(() => {
    latest.current = report;
  }, [report]);
  const measuring = report !== undefined;
  useEffect(() => {
    const element = box.current;
    if (element === null || !measuring) return;
    // Guarded by CALLABILITY rather than presence: jsdom defines the global on
    // some setups without a working constructor, so a property test passes and
    // the construction throws.
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry === undefined) return;
      latest.current?.(inlineSizeOf(entry));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      /*
       * The box is gone, so the last number it reported describes nothing.
       *
       * Left standing, a caller goes on deriving a tier from a width no
       * element has — and the editor unmounts this canvas whenever the site's
       * stored styles stop being readable, which a cached query can do on a
       * refocus long after the first measurement. The inspector would keep
       * writing into whichever tier the stale width implied, with no preview
       * box on screen and the control that sets it disabled.
       *
       * `undefined` is the honest report and the one the caller already
       * handles: nothing has been observed.
       */
      latest.current?.(undefined);
    };
  }, [box, measuring]);
}

/**
 * The width of the REGION the canvas has been given, or `undefined` until it
 * has been measured.
 *
 * The canvas's own parent, which the canvas does not own — the same dependency
 * `min-height: 100%` already has, and for the same reason: how much room there
 * is is a fact about the surface hosting the editor, not about the document.
 *
 * Measured rather than passed, so a host cannot state a region that disagrees
 * with the one it laid out. A number a caller supplies is a second answer to a
 * question the box can be asked directly, and the two would first disagree when
 * a rail is toggled — exactly when the scale has to change.
 *
 * `clientWidth` is not used, and the difference is load-bearing: it is an
 * integer, so a fractional region rounds and the scale derived from it leaves
 * the painted box a fraction wide of the space, which reads as a hairline of
 * background down one edge that moves as the pane is dragged.
 *
 * Observed only while `scaling`, so a canvas that fills its region builds no
 * observer at all — there is nothing for it to answer, and one that exists
 * anyway fires on every pane drag for a number nobody reads.
 */
/**
 * The nearest ancestor that actually lays the canvas out.
 *
 * NOT `parentElement`, which is the DOM parent and not necessarily the element
 * whose width the canvas is fitted into. `display: contents` leaves a node in
 * the tree while generating no box at all, so its children are laid out by ITS
 * parent — and a `ResizeObserver` on one reports an inline size of zero.
 * Measured in a browser: a boxless wrapper inside a 911px container observes
 * `0` while the container observes `911`.
 *
 * That is not hypothetical here. The block context menu wraps the canvas in
 * Radix's trigger and gives it `display: contents` deliberately, so a `span`
 * around a block box does not change the layout it is meant to be transparent
 * over. Measuring through it made `canvasScale` see a region of zero, take its
 * identity branch, and report a fit of `1` forever: an author who pinned Tablet
 * at 1024 was editing at the region's own width with the control still showing
 * Tablet selected, and no width readout to contradict it.
 *
 * Written as a WALK rather than as a check for that one wrapper. The wrapper
 * arrived legitimately and nothing connected it to a measurement two files
 * away; the next one would do the same. Skipping every boxless ancestor is the
 * property the measurement actually needs.
 *
 * `display: none` is deliberately NOT skipped past — it is boxless too, but its
 * children generate no box either, so there is no canvas being laid out
 * anywhere and the honest answer is the hidden ancestor itself, whose zero
 * leaves the scale at its identity.
 */
function layoutRegionOf(element: HTMLElement | null): HTMLElement | null {
  const view = element?.ownerDocument.defaultView ?? null;
  if (view === null) return null;
  for (
    let node = element?.parentElement ?? null;
    node !== null;
    node = node.parentElement
  ) {
    if (view.getComputedStyle(node).display !== "contents") return node;
  }
  return null;
}

function useRegionWidth(
  box: React.RefObject<HTMLElement | null>,
  scaling: boolean
): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!scaling) return;
    const region = layoutRegionOf(box.current);
    if (region === null) return;
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry === undefined) return;
      setWidth(inlineSizeOf(entry));
    });
    observer.observe(region);
    return () => {
      observer.disconnect();
      // The region is gone, so its last width describes nothing. Reported as
      // absent, the scale falls back to 1 — which is the identity, and the
      // only answer that cannot place the canvas somewhere nobody can see.
      setWidth(undefined);
    };
  }, [box, scaling]);
  return width;
}

/**
 * How much the canvas must be shrunk for the width it was asked for to fit.
 *
 * `1` whenever the request already fits, which is the ordinary case and must
 * stay pixel-exact: a canvas showing a tier narrower than its region is not
 * simulating anything and has nothing to gain from being resampled.
 *
 * Never above 1. A region wider than the request means the box is simply
 * narrower than the space, which the auto margins centre; magnifying it would
 * show the author a page larger than life and make every measurement they take
 * from the screen wrong in the flattering direction.
 *
 * `1` for an unmeasured or nonsensical region as well. This runs before the
 * first measurement on every mount, and a scale derived from `undefined` — or
 * from a region of zero, which a collapsed pane reports — is either `NaN` or
 * infinite, neither of which fails loudly: both produce a canvas that is
 * present, painted nowhere, and impossible to aim at.
 */
export function canvasScale(
  requested: number | undefined,
  region: number | undefined,
  zoom: CanvasZoom = FIT_ZOOM
): number {
  /*
   * A chosen scale is not derived from anything, which is the whole of what
   * choosing means. It is answered before the guards below because those exist
   * to make a FIT computable — an unmeasured region cannot be fitted to, and a
   * fixed scale never needed it.
   */
  if (zoom.kind === "fixed") {
    // A host can build this value directly, so it has not necessarily been
    // through the storage guard. An unusable one falls back to fitting rather
    // than being painted: an invalid `zoom` declaration is dropped by the
    // browser and an enormous one puts the page beyond reach of the control
    // that would undo it.
    const usable = usableScale(zoom.scale);
    if (usable !== null) return usable;
  }
  if (requested === undefined || region === undefined) return 1;
  if (!(requested > 0) || !(region > 0)) return 1;
  return Math.min(1, region / requested);
}

/** A width the box is given, in whichever of the two forms it is given in. */
type BoxWidth = { width: string } | { maxWidth: string };

/**
 * A width, and the centring that travels with it.
 *
 * The centring is not a property of any one of the shapes below — it is a
 * property of HAVING a width. A box told how wide to be is narrower than the
 * region it sits in, and a narrow box parked against the left edge reads as a
 * layout that has broken rather than as a viewport being simulated.
 *
 * Stated here rather than at each `return` because it was previously stated at
 * one of them. The other three set a width and omitted the margin, so the
 * canvas centred while fitting and jumped to the left edge the moment an author
 * chose a scale — the same tier, the same width, alignment deciding itself on
 * which branch produced it. Taking a width only through this function is what
 * makes that disagreement unspellable rather than merely fixed.
 *
 * The one branch that sets NO width does not call this, and must not: a box
 * with no width fills the region, so there is no free space, and an author
 * reading the canvas root would find a margin that governs nothing.
 *
 * `marginInline` rather than a flex or grid alignment on the region, because
 * the margin resolves against whatever free space exists at the time. Measured
 * across the range this canvas paints at: at half scale a 912px region gives
 * 228px each side, and above 1 the box is wider than the region, the free space
 * is negative, and the margins resolve to zero — so the overflow scrolls from
 * the left edge with nothing clipped, which is what an author magnifying to
 * inspect something needs. No branch on the scale is required to get both.
 */
function centred(width: BoxWidth): React.CSSProperties {
  return { ...width, marginInline: "auto" };
}

/**
 * The canvas root's own style: the container the sheet queries, the width the
 * box is asked to show, and the scale that makes that width fit.
 *
 * Two shapes, because a request that fits and a request that does not are
 * different situations rather than one with a parameter.
 *
 * WHERE IT FITS, the width is a MAXIMUM. Every width here is centred — see
 * `centred` above for why that belongs to the width rather than to the branch.
 *
 * WHERE IT DOES NOT, the width is EXACT and a transform shrinks the box until
 * it does. That is the only way the widest tier stays editable at all: the
 * region is around 912px on the supported 1280px shell, so a site whose widest
 * bound is 1024 has no width an author can ask for that puts the box above it,
 * and the unconditional tier becomes unreachable. Capping the width there does
 * not simulate a 1280px viewport — it simulates a 912px one and reports the
 * wrong tier with confidence.
 *
 * `zoom` rather than a transform, which is the opposite of what it looks like
 * it should be and was measured both ways. Both keep the container queries
 * resolving at the REQUESTED width — neither changes the width the box is laid
 * out at, so `offsetWidth` and `contentBoxSize` still report 1280 — and both
 * leave `getBoundingClientRect` answering in painted pixels.
 *
 * They differ in what the SCROLL CONTAINER sees, and only `zoom` is usable
 * there. A transform is paint-time, so the canvas section still reserves the
 * unscaled layout box: measured in a 912x400 region at 0.7125, a transform
 * leaves 368px of blank horizontal scroll, and compensating its height to fill
 * the region adds 161px of blank vertical scroll — a tail an author, or drag
 * autoscroll, can travel into until the page is off screen. `zoom` participates
 * in layout, so the section reserves the painted box and both tails are zero.
 *
 * That participation is the very thing that argued against it: `zoom`'s
 * documented weakness is inconsistency in how it interacts with other layout
 * features, and this canvas is all layout — overlays, drop targets,
 * hit-testing. But not participating is what produces two scroll defects that a
 * measured wrapper would then exist to undo, and the properties those readers
 * actually depend on were measured directly and hold.
 */
function previewBoxStyle(
  preview: CanvasPreview | undefined,
  scale: number,
  chosen: boolean
): React.CSSProperties {
  /*
   * A CHOSEN scale applies with no preview at all.
   *
   * Previewing needs a container name and a site that declares viewport tiers;
   * a site with neither — which the default configuration is — has no preview
   * object, and returning nothing here left the zoom control moving a number
   * on screen and changing nothing. How large the canvas draws is not a
   * property of whether a viewport is being simulated.
   */
  if (preview === undefined) {
    return chosen
      ? { ...centred({ width: `calc(100% * ${scale})` }), zoom: scale }
      : {};
  }
  const container = previewContainerStyle(preview.container);
  /*
   * No requested width means the box fills the region, which is the widest
   * tier and the state the editor opens in. There is nothing to FIT there —
   * the box is already the region — but a chosen scale still applies: it
   * magnifies or shrinks what is drawn and the region scrolls, which is the
   * whole of what an author asked for. Returning early here left the control
   * reporting a number that changed nothing at the tier it is used at most.
   */
  if (preview.width === undefined) {
    if (!chosen) return container;
    /*
     * The width is PINNED before zooming, and that is the whole of this branch.
     *
     * `zoom` participates in layout, so it divides the logical width the
     * container queries resolve against: at 200% a 911px region became 455px
     * and the canvas silently started previewing the MOBILE tier. An author
     * magnifying to look closely at something was shown a different layout
     * instead — measured on screen, where the tier readout changed with the
     * zoom.
     *
     * Fixing the box at the width it had leaves the queries resolving against
     * that same width whatever the scale, so magnifying magnifies and nothing
     * else moves. Without a measured region there is nothing to pin, and the
     * scale is left off rather than applied against a width that would shift.
     */
    return {
      ...container,
      // `100%` resolves against the containing block in this element's OWN
      // coordinates, which `zoom` has already divided by the scale — so a
      // plain full width comes out at `region / scale` logically. Multiplying
      // it back restores the width the box had, and the scale then paints it
      // larger without moving what the queries resolve against. No measurement
      // is involved, so there is no observer to disagree with the layout.
      ...centred({ width: `calc(100% * ${scale})` }),
      zoom: scale,
    };
  }
  /*
   * A FIT that needs no shrinking is left unzoomed and centred, which is the
   * shape a canvas showing a page at its own size has always had.
   *
   * A CHOSEN scale is applied whatever its value, including 1 and above. The
   * two are not the same request: fitting to 1 means "it already fits", while
   * choosing 1 means "draw it at actual size and let the region clip" — and at
   * anything above 1 there is no reading of `maxWidth` that magnifies.
   */
  if (!chosen && scale >= 1) {
    return { ...container, ...centred({ maxWidth: `${preview.width}px` }) };
  }
  /*
   * Reached two ways, and only one of them has slack to centre.
   *
   * FITTING, the scale is derived from the region, so the box paints at exactly
   * the region's width and the margins resolve to zero — measured, 912px into
   * 912px. CHOSEN, the scale is the author's and owes the region nothing: a
   * 375px tier at any scale at all paints narrower than the region it sits in,
   * which is the case that was left against the left edge.
   */
  return {
    ...container,
    ...centred({ width: `${preview.width}px` }),
    zoom: scale,
  };
}

/**
 * The canvas root's surface: what it queries, how wide it is asked to be, how
 * far it must shrink for that width to fit, and what it ended up being.
 *
 * One decision rather than several statements in the component, because they
 * are not independent. Three numbers describe this box — the width an author
 * asked for, the room the region has, and the width the box ended up with — and
 * only the first is chosen. The scale is DERIVED from the first two and the
 * third is REPORTED from the result, so there is no stored value that can
 * disagree with any other. Kept apart, a component holds all three and each can
 * be updated without the rest.
 */
function useCanvasSurface(
  root: React.RefObject<HTMLElement | null>,
  preview: CanvasPreview | undefined,
  zoom: CanvasZoom,
  onScale: ((scale: number) => void) | undefined
): React.CSSProperties {
  // What the box GOT, reported outward to whoever asked.
  useReportedInlineWidth(root, preview?.onMeasured);
  // What the box has ROOM for, read inward to decide how far it must shrink.
  // Observed only where a width was asked for: a canvas filling its region has
  // nothing to scale, and an observer that exists to answer a question nobody
  // asked still fires on every pane drag.
  const region = useRegionWidth(root, preview?.width !== undefined);
  const scale = canvasScale(preview?.width, region, zoom);
  /*
   * Reported through a ref, keyed on the scale and on whether anyone is
   * listening — never on the reporter's identity.
   *
   * A host writing `onScale={s => setView({ ...view, scale: s })}` inline hands
   * a new function every render. Depended on directly, each report updates the
   * host, the update produces a new identity, and the new identity reports
   * again: a render loop on a host that did nothing wrong.
   *
   * Existence is a dependency because it changes the answer. A host that wires
   * the reporter after its first render — one resolving `onScale` from state,
   * or a shell whose control mounts late — would otherwise hear nothing until
   * the scale next moved, and sit on a stale number in the meantime.
   */
  const latestScaleReport = useRef(onScale);
  useEffect(() => {
    latestScaleReport.current = onScale;
  }, [onScale]);
  const reportingScale = onScale !== undefined;
  useEffect(() => {
    latestScaleReport.current?.(scale);
  }, [reportingScale, scale]);
  /*
   * CHOSEN means a scale the author asked for AND this canvas can paint at.
   * A refused one has already fallen back to fitting above, so treating it as
   * chosen here would apply the fit's own scale as though it were a choice —
   * writing `zoom: 1` onto a canvas that should carry no zoom at all.
   */
  const chosen = zoom.kind === "fixed" && usableScale(zoom.scale) !== null;
  return previewBoxStyle(preview, scale, chosen);
}

/**
 * Mark the selected elements on the rendered tree.
 *
 * Applied AFTER the renderer has produced them, rather than asked of
 * `PageRenderer`. Which node an editor considers current is an editor's
 * concern, and a published route renders the same document without one —
 * pushing it into the renderer's contract would put editor state in the
 * component that serves live pages.
 *
 * Ids are COMPARED in JavaScript rather than matched with a selector built from
 * one. A node id reaches this from stored data, and interpolating it into
 * `querySelector` makes any character CSS treats specially either throw or,
 * worse, match something else.
 *
 * `page` is a dependency because the rendered tree is what carries the markers:
 * a re-render replaces the elements, and an effect keyed on the selection alone
 * would leave the new tree carrying none at all.
 */
function useSelectionMarkers(
  box: React.RefObject<HTMLElement | null>,
  marked: readonly string[],
  selectedId: string | null,
  page: React.ReactNode,
  forcedState: StyleState | undefined
): void {
  useEffect(() => {
    const container = box.current;
    if (container === null) return;
    /*
     * NAMED and re-run rather than written straight into the effect, because
     * the dependency list is not the only thing that changes the answer.
     *
     * A block whose `render` returns a promise commits its Suspense fallback
     * first and its resolved root later. That second commit inserts the element
     * carrying the node id while changing no prop, no state and no id in this
     * list — so an effect that ran once would have marked a tree the resolved
     * block was not in yet, and would leave it unmarked until an unrelated
     * selection or document change happened to run this again. Selecting a
     * `core/collection-loop` showed exactly that: no outline and no forced
     * state, on an ordinary shipping block.
     */
    const mark = (): void => {
      /*
       * Every element a marker can land on OR currently carries one, which are
       * not the same set. A render can move a node id from one existing element
       * to another without touching the child list — the attribute case this
       * effect subscribes to — and the element that LOST the id then matches
       * nothing selected by node id. Left out, it keeps the selection attribute
       * and the state class it was last given: a second outline around a block
       * nothing is editing, and a hover appearance forced on it.
       *
       * The rendered PAGE ROOT is named explicitly rather than reached by one
       * of the marker selectors: `PageRenderer` draws `.nx-pb-page` as a child
       * of this container and the page tier compiles onto that element rather
       * than onto the canvas wrapper, so it must be markable before it has ever
       * been marked.
       */
      const touched = new Set<Element>([container]);
      // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
      // that declares its iterator, and this package compiles without one — so the
      // loop that reads more naturally does not type-check here.
      container
        .querySelectorAll(
          [
            `.${PAGE_ROOT_CLASS}`,
            `[${NODE_ID_ATTRIBUTE}]`,
            `[${SELECTED_ATTRIBUTE}]`,
            ...STYLE_STATES.map(state => `.${previewStateClass(state)}`),
          ].join(", ")
        )
        .forEach(element => touched.add(element));

      touched.forEach(element => {
        const id = element.getAttribute(NODE_ID_ATTRIBUTE);
        if (id === null || !marked.includes(id)) {
          // Guarded like the writes below: this walk now visits the page root
          // and the container, which never carry the attribute, and removing an
          // absent one still touches the element.
          if (element.hasAttribute(SELECTED_ATTRIBUTE)) {
            element.removeAttribute(SELECTED_ATTRIBUTE);
          }
          return;
        }
        // The VALUE carries which member the panels answer for. A boolean
        // attribute could not, and a second attribute for the primary would be a
        // state where a block is primary without being selected.
        //
        // Compared before writing, for the reason the class below is: this walk
        // re-runs on every change to the rendered tree, and `setAttribute`
        // queues a mutation record even when the value it writes is the value
        // already there. Unguarded, marking a tree that did not change is
        // itself a change — the spacing overlay observes this subtree and
        // re-measures on one, so its own output would arrive back here as a
        // reason to write again.
        const value = id === selectedId ? "primary" : "";
        if (element.getAttribute(SELECTED_ATTRIBUTE) !== value) {
          element.setAttribute(SELECTED_ATTRIBUTE, value);
        }
      });

      /*
       * The forced interaction state, in the SAME walk rather than a second one.
       * Both answer "what is marked on this element right now", and two walks
       * over one question drift — one runs on a change the other does not.
       *
       * On the PRIMARY alone. A page cannot force a pseudo-class on itself, so
       * the compiler emits a class alternative beside each one and this puts it
       * on the element the panel is editing. Forcing it page-wide would show
       * every other block in a state nobody asked about.
       *
       * Cleared from everything first, including the primary: a state that
       * changes from hover to focus, or a selection that moves, must not leave
       * the previous class behind on an element nothing is editing.
       */
      /*
       * WHICH ELEMENTS a forced state belongs on, ASKED of the engine rather
       * than decided here.
       *
       * Whether a state propagates follows from the pseudo-class the compiler
       * emits for it — an ancestor matches `:hover` and `:active` and does not
       * match `:focus-visible` — so the two facts live together beside that
       * definition. Encoding the rule here as well would be a second opinion
       * about the CSS: changing `focus` to `:focus-within` would move the
       * published rules and leave this canvas marking the wrong chain, with both
       * sides type-correct.
       *
       * Where a state does propagate the chain is required rather than tidy: the
       * page tier compiles onto the RENDERED page root, and a marker on a
       * descendant cannot make its ancestor match.
       */
      const chain = new Set<Element>();
      if (forcedState !== undefined && forcedState !== "base") {
        /*
         * EVERY rendering of the primary node, not the first one found.
         *
         * A node id is unique in a DOCUMENT and not in the tree drawn from it:
         * `core/collection-loop` draws its children once per entry, so one
         * selected node is many elements, and the walk above has already marked
         * all of them primary. Taking `querySelector` here would preview the
         * state on whichever copy came first in DOM order — the outline on ten
         * rows and the hover appearance on one, which reads as the state being
         * broken rather than as the preview being partial.
         */
        container
          .querySelectorAll(`[${SELECTED_ATTRIBUTE}="primary"]`)
          .forEach(primary => {
            chain.add(primary);
            if (!statePropagatesToAncestors(forcedState)) return;
            for (
              let node: Element | null = primary.parentElement;
              node !== null && container.contains(node);
              node = node.parentElement
            ) {
              chain.add(node);
            }
          });
      }

      // The SAME set the selection was written from, so the two markers cannot
      // disagree about which elements exist.
      const marks: Element[] = Array.from(touched);

      marks.forEach(element => {
        // `base` is not a state anything forces: it is what applies when nothing
        // else does, and the compiler emits no marker for it.
        const wanted =
          chain.has(element) && forcedState !== undefined
            ? previewStateClass(forcedState)
            : undefined;

        /*
         * WRITTEN ONLY WHEN IT CHANGES, which is not a micro-optimisation.
         *
         * `classList.remove` of a token that is not present still touches the
         * attribute, and this canvas is observed: the empty-container appender
         * watches its subtree for layout-relevant mutations and re-measures on
         * one. An unconditional clear across every marked element therefore made
         * every selection change schedule a re-measure of the whole overlay,
         * which its own test caught — it asserts the control does NOT move for a
         * mutation of its own output, and it moved.
         */
        for (const state of STYLE_STATES) {
          const marker = previewStateClass(state);
          if (marker !== wanted && element.classList.contains(marker)) {
            element.classList.remove(marker);
          }
        }
        if (wanted !== undefined && !element.classList.contains(wanted)) {
          element.classList.add(wanted);
        }
      });
    };

    mark();
    // Subscribed AFTER the first pass, because an observer reports what changes
    // from the moment it attaches and says nothing about the tree already
    // there. Writing the markers cannot re-enter this: what counts as the tree
    // changing excludes every attribute `mark` writes.
    return observeRenderedTree(container, mark);
  }, [box, selectedId, marked, page, forcedState]);
}

/**
 * Which ids to mark, given what the host supplied.
 *
 * The primary alone when a host has not adopted the set yet, which keeps every
 * existing caller correct without a change. `[]` rather than `[null]` for an
 * empty selection: the marker is applied by id, and a null in the set would
 * match the elements carrying no id at all.
 */
function markedIds(
  selectedIds: readonly string[] | undefined,
  selectedId: string | null
): readonly string[] {
  if (selectedIds !== undefined) return selectedIds;
  return selectedId === null ? [] : [selectedId];
}

/**
 * The canvas's pointer handlers, which share one rule: chrome is not the page.
 *
 * Together rather than separately, because that rule is the whole of what they
 * have in common and a version where each handler remembers it for itself is
 * the version where the next one does not. Pressing a control drawn over the
 * canvas would otherwise resolve to "no node" and deselect the very block that
 * control acts on.
 */
function useCanvasPointer(
  onSelect: ((id: string | null, mode: SelectionMode) => void) | undefined,
  onDoubleClick:
    | ((event: React.MouseEvent<HTMLDivElement>) => void)
    | undefined,
  marked: readonly string[]
): {
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
} {
  const click = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (onSelect === undefined || isChrome(event.target)) return;
      // A click on the canvas background resolves to null, which CLEARS the
      // selection rather than being ignored. Ignoring it leaves an inspector
      // showing a node the author believes they have deselected.
      onSelect(nodeIdFromEvent(event.target), selectionModeFor(event));
    },
    [onSelect]
  );
  const doubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isChrome(event.target)) return;
      onDoubleClick?.(event);
    },
    [onDoubleClick]
  );
  /*
   * The secondary button selects, and says whether anything above this has a
   * block to act on.
   *
   * Selecting FIRST is the whole point. A menu opened over one block while the
   * selection sits on another acts on the other one, and the author is looking
   * at the block they aimed at — so the destructive verbs on it would be aimed
   * somewhere they cannot see.
   *
   * A block already in the selection is left alone rather than replacing it.
   * Right-clicking one of several chosen blocks to act on all of them is what
   * every comparable editor does, and re-selecting would silently drop the rest
   * of the author's selection at the moment they went looking for a verb.
   *
   * Over the canvas BACKGROUND the event is stopped instead. There is no node,
   * so a menu of block verbs would have no subject; stopping it here rather
   * than opening an empty one keeps that decision next to the hit test that
   * establishes it.
   */
  const contextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      /*
       * Three ways to have no block to act on, stopped the same way and for
       * separate reasons — see each predicate. Stopping rather than merely
       * returning is what matters: a menu mounted ABOVE the canvas sees
       * whatever this lets past, and the chrome and the appenders are drawn
       * INSIDE the canvas root, so a bare return offers the selected block's
       * verbs for a gesture aimed at a button that is not a block.
       *
       * `preventDefault` is deliberately not called, so the browser's own menu
       * still appears wherever this one does not.
       */
      const id = contextMenuTargetOf(event.target, event.currentTarget);
      if (id === null) {
        event.stopPropagation();
        return;
      }
      if (onSelect === undefined || marked.includes(id)) return;
      onSelect(id, "replace");
    },
    [marked, onSelect]
  );
  /*
   * The same withholding, for the gesture that carries no context event.
   *
   * A menu mounted above the canvas can open a touch or pen LONG PRESS from a
   * timer of its own, started on this event — no `contextmenu` is ever
   * dispatched, so the rule above never runs and every rejection it makes is
   * skipped. Withholding the press from anything above keeps one decision
   * governing both ways in.
   *
   * `stopPropagation` and NOT `preventDefault`, which is the whole point of
   * doing it here. This fires at the start of every contact, long before
   * anything knows whether it will become a long press, and cancelling the
   * default that early takes caret placement and text selection away from an
   * author who was only tapping into a sentence.
   */
  const pointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (contextMenuTargetOf(event.target, event.currentTarget) === null)
        event.stopPropagation();
    },
    []
  );
  return {
    onClick: click,
    onDoubleClick: doubleClick,
    onContextMenu: contextMenu,
    onPointerDown: pointerDown,
  };
}

/**
 * A canvas showing the page inside a resizable box rather than at the browser's
 * own width.
 *
 * The container is REQUIRED and the rest is not, because it is what makes the
 * other two mean anything: the editor canvas is not an iframe, so the sheet is
 * emitted into the admin document and `@media` asks the WINDOW. Only a sheet
 * compiled against a container name has rules this box can answer.
 */
export interface CanvasPreview {
  /**
   * The container name the sheet was compiled against.
   *
   * Passed through {@link previewContainerStyle}, which supplies the
   * `container-type` alongside the name: a named container left at the default
   * `normal` is not a size-query container, so every rule the preview compile
   * emitted stays inactive while the sheet is valid and the name matches.
   */
  container: string;
  /**
   * The width to lay the box out at, in CSS pixels, or absent to fill the
   * region.
   *
   * HONOURED, whatever the region can hold. A region narrower than the tier
   * being asked for does not cap it — the box is laid out at this width and
   * PAINTED smaller, so what the container queries resolve against is the tier
   * that was asked for rather than the one the region happens to imply.
   *
   * It was a maximum, and capping is what made the unconditional tier
   * unreachable: the region is around 912px on the supported 1280px shell, so
   * against a site bounding tablet at 1024 no requested width could ever put
   * the box above it. A capped box does not simulate the viewport asked for; it
   * simulates the region's own width while reporting the wrong tier.
   *
   * So this is the LAYOUT and query width. The painted width is this times the
   * scale the canvas derives, and it is not reported: nothing outside needs it,
   * and a second width on this object is a second thing to disagree.
   */
  width?: number;
  /**
   * The box's MEASURED inline size, reported whenever it changes.
   *
   * Still reported rather than derived from {@link CanvasPreview.width}, even
   * though a requested width is now honoured. They are different numbers
   * whenever none was requested — the box then takes the region, and the region
   * is not something the host states — and they are different again for the
   * render before the first measurement arrives. A caller reading the request
   * would name a tier for a box nobody has looked at.
   *
   * A LAYOUT size, which is the one the container queries answer to. It is not
   * the painted width: a canvas scaled to fit is drawn smaller than it is laid
   * out, and reporting what a reader sees would name the tier the region
   * implies rather than the tier the page is being compiled against — the
   * confident-wrong-answer this whole preview mechanism exists to remove.
   *
   * `undefined` until the first measurement, which is a real state rather than
   * a default: nothing has been observed yet, and a caller must not report a
   * tier as live on the strength of a box nobody has looked at.
   */
  onMeasured?: (width: number | undefined) => void;
}

/**
 * The breakpoints the compile will actually run against, or `undefined` when
 * nothing will be compiled at all.
 *
 * ASKED of the renderer rather than worked out here. `sharedStyleInputs` is the
 * function `PageRenderer` itself reconciles with, so this reads the answer the
 * render will use instead of a second one that happens to agree.
 *
 * That distinction is not theoretical, because the rule has more in it than it
 * looks. The site tier wins for `breakpoints`, the route wins for
 * `previewContainer`, and both skip only `undefined` — so a stated `null`
 * survives, where a nullish coalesce would discard it. Three separate ways to
 * be wrong, none of them visible from the inputs, and each one produces a
 * canvas that compiles against a different set of tiers than the page does.
 *
 * `undefined` still means exactly what it did: neither binding site stated a
 * set, which is `siteStyles={false}` beside a stored artifact carrying no style
 * context.
 */
function compiledBreakpoints(
  render: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>
): BreakpointSet | undefined {
  const stated = sharedStyleInputs(
    render?.styleContext,
    // `false` is a host serving no site sheet, which states no breakpoints —
    // not a sheet whose breakpoints are absent.
    typeof siteStyles === "object" ? siteStyles : undefined
  ).breakpoints;
  /*
   * A stated NULL collapses to `undefined` HERE, and only here.
   *
   * It had to survive the reconciliation, which is where it means something: a
   * site stating null defines no viewport tiers, and that outranks a route
   * context which has some. By this line that contest is over, and what is left
   * is a canvas asking whether there are tiers to preview. There are not, which
   * is what `undefined` says to every reader below.
   *
   * Collapsed any EARLIER — inside the reconciler, or with a nullish coalesce
   * over the two tiers — the null loses to the route's set and the canvas
   * previews a tier the renderer left on base. That is the defect this
   * function's own docblock names, and it is why the null reaches this far.
   */
  return stated ?? undefined;
}

/**
 * Whether this canvas is previewing at all, and under what name.
 *
 * Asked once, here, so the sheet, the box and the measurement cannot disagree
 * about it. Two things make a preview inert despite a caller asking for one,
 * and they fail the same way — the box constrains and measures while the rules
 * still answer to the WINDOW, so a caller deriving an edit target from the
 * measurement writes to a tier the canvas is not displaying.
 *
 * A REFUSED name is the first: `previewContainerName` turns down an empty,
 * reserved, malformed or oversized value, and the compile falls back to
 * published `@media`.
 *
 * NOWHERE TO BIND is the second, and the name is perfectly good in that one.
 * There are exactly two binding sites — the page tier's style context and the
 * site tier's sheet — and a caller can legitimately have neither:
 * `siteStyles={false}` opts out of the shared sheet, and a stored artifact
 * arrives with no style context.
 *
 * NOTHING TO SIMULATE is the third. A preview compile rewrites every
 * CONTAINER-axis rule to `@container nx-not-previewable (width < 0px)`, which
 * matches nothing — the engine refusing a question a preview box cannot answer,
 * and the right trade when there are viewport tiers to gain in exchange. With
 * no emitted viewport tier the same price buys nothing: a container-only site
 * would have every one of its breakpoints stop matching here while they keep
 * working on the published page. Decided in the component rather than at one
 * mount, so every consumer of this API keeps published mode for that set.
 */
function activePreview(
  render: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>,
  preview: CanvasPreview | undefined
): CanvasPreview | undefined {
  const container = previewContainerName(preview?.container);
  if (preview === undefined || container === undefined) return undefined;
  const breakpoints = compiledBreakpoints(render, siteStyles);
  // Undefined here IS "nowhere to bind": the two binding sites are the only
  // places a breakpoint set can come from, so their absence is one condition
  // rather than two that have to be kept in step.
  if (breakpoints === undefined) return undefined;
  return offeredTiers(breakpoints).length === 0
    ? undefined
    : { ...preview, container };
}

/**
 * The renderer's inputs, made to agree with the box the canvas establishes.
 *
 * BOTH tiers, from one hook, because they are one decision read twice. A page's
 * node styles and a site's named classes each emit their own breakpoint rules
 * and each carry their own `previewContainer`; bound on only one, a class's
 * tablet rule stays an `@media` answered by the WINDOW while the node's tablet
 * rule became a `@container` answered by the box — so narrowing the canvas
 * moves one and not the other, and a block styled by a class does not respond.
 *
 * The container is written IN rather than asked for: it and the container this
 * element establishes are the same fact, and a caller holding two places to say
 * it has two chances to say it differently. Overwritten rather than defaulted,
 * so a host supplying a different name is corrected instead of believed.
 */
function usePreviewedInputs(
  render: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>,
  preview: CanvasPreview | undefined
): {
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  sheet: NonNullable<PageRendererProps["siteStyles"]>;
  /**
   * The preview that is actually in force, or `undefined` when none is.
   *
   * A NAME the compiler refuses is not a preview. `previewContainerName` turns
   * down an empty, reserved, malformed or oversized value, and the compile then
   * falls back to published `@media` — so a box that went on constraining and
   * measuring itself would resize without changing a single tier, and a caller
   * deriving an edit target from the measurement would write to a breakpoint
   * the canvas is not displaying. That is the same confident-wrong-answer the
   * whole mechanism exists to remove, arrived at through the refusal path.
   *
   * Normalised HERE and nowhere else, so the sheet, the box and the measurement
   * cannot disagree about whether this canvas is previewing at all.
   */
  active: CanvasPreview | undefined;
} {
  const active = activePreview(render, siteStyles, preview);
  /*
   * Keyed on the container NAME, not on the preview object.
   *
   * `preview.width` changes on every switcher selection and an inline
   * `onMeasured` changes on every render, and neither alters a single emitted
   * rule — but depending on the object rebuilds these inputs, which rebuilds
   * the rendered page, which recompiles the document and the site sheet
   * synchronously. On a large document that is the cost of a whole compile per
   * width change, and continuous resizing pays it per frame.
   *
   * The box's own inputs travel outside this memo, in `active`, where being a
   * fresh object costs nothing: the style is recomputed from it directly and
   * the measurement effect keys on whether a reporter EXISTS rather than on its
   * identity.
   */
  const container = active?.container;
  const compiled = useMemo(() => {
    if (container === undefined) {
      return { rendered: render, sheet: siteStyles };
    }
    return {
      /*
       * `styleContext` absent is left alone: without it the renderer compiles
       * no per-node sheet, so there are no page rules for a container to
       * answer.
       */
      rendered:
        render?.styleContext === undefined
          ? render
          : {
              ...render,
              styleContext: {
                ...render.styleContext,
                previewContainer: container,
              },
            },
      /*
       * `false` is a real value — a host saying it serves NO site sheet — and
       * spreading it would turn that refusal into an object carrying a
       * container name and nothing else, compiling an empty sheet where the
       * caller asked for none.
       */
      sheet:
        typeof siteStyles === "object"
          ? { ...siteStyles, previewContainer: container }
          : siteStyles,
    };
  }, [render, siteStyles, container]);
  return { ...compiled, active };
}

export interface CanvasProps {
  /** The document being edited. */
  document: BlockDocument;
  /**
   * Receives the canvas root element, for a caller that needs to measure
   * against it.
   *
   * A drag that begins OUTSIDE the canvas — from a palette row — has no event
   * whose `currentTarget` is this element, and it must resolve a drop position
   * against the same box every other reader uses. This canvas owns that
   * element, so handing it over is more honest than a caller finding it by
   * class name: a query would be a second place that decides which element the
   * canvas root is.
   *
   * READ IT IN A HANDLER, NOT AN EFFECT, and that is a property of the call
   * site rather than of this prop — so it travels with nothing and has to be
   * said here. A ref answers "where is the canvas now" at press time, long
   * after mount. An effect asking the same ref reads `null` on its first run
   * and is never told otherwise, because assigning `.current` changes no
   * dependency and this canvas mounts only once styles have loaded. Anything
   * that must REACT to the canvas arriving takes {@link CanvasProps.onRoot}.
   */
  rootRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * The interaction state the panel is editing, forced on the primary
   * selection so an author can SEE what they are editing.
   *
   * A page cannot force a pseudo-class on itself — there is no CSS or DOM way
   * to make an element match `:hover` without a pointer. So the sheet has to be
   * compiled with `previewStates`, which gives each state a class alternative
   * beside its pseudo-class, and this canvas puts that class on one element.
   * Passed a state without that compile, nothing happens and nothing breaks:
   * the class is simply in no selector.
   *
   * `base` forces nothing. It is what applies when no state does.
   */
  forcedState?: StyleState;
  /**
   * The same element, published as a VALUE so a caller can react to it
   * appearing.
   *
   * A ref is not reactive. This canvas mounts only once styles have loaded
   * while the surfaces beside it stay mounted throughout, so a reader that
   * captured `rootRef` on its first render sees `null` and is never told
   * otherwise — assigning `.current` changes no dependency, so an effect
   * listing the ref never looks again.
   *
   * `rootRef` stays for the readers that only ever ask "where is it now" during
   * a gesture, where a ref is exactly right.
   */
  onRoot?: (root: HTMLDivElement | null) => void;
  /**
   * The site sheet, the same value the published route passes. Required — see
   * the module docblock for why this one is not optional.
   */
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>;
  /**
   * The preview box this canvas establishes, or absent to render at the
   * region's own width against a published sheet.
   *
   * One object rather than three props, for the reason
   * {@link CanvasProps.dragHandlers} is one: the set cannot then be PARTIALLY
   * wired, and every partial wiring here fails silently. A width without a
   * container resizes a box whose sheet still queries the window, so the page
   * reflows and not one breakpoint changes. A container nobody observes leaves
   * the surface that owns the box unable to say which tier is live.
   *
   * The container also travels INTO the compile from here rather than being
   * asked for twice: `render.styleContext.previewContainer` is overwritten with
   * `container`, so the box the queries are written against and the box this
   * element establishes cannot be different names.
   */
  preview?: CanvasPreview;
  /**
   * The PRIMARY selected node's id, or null when the selection is empty.
   *
   * The one the inspector edits. Marked `data-nx-selected="primary"` so a
   * multi-block selection can show which member the panels answer for — with
   * one block selected there is nothing to distinguish and the distinction
   * costs nothing.
   */
  selectedId?: string | null;
  /**
   * Every selected id. Defaults to the primary alone.
   *
   * A separate prop rather than derived from `selectedId`, because the canvas
   * must not decide what a selection IS — `selection.ts` does, and a canvas
   * that reconstructed the set from one id would silently disagree with it the
   * moment there were two.
   */
  selectedIds?: readonly string[];
  /**
   * Raised with the clicked node's id and the gesture its modifiers meant, or
   * null when the click hit no node.
   *
   * The MODE travels with the id because only the event knows it, and a caller
   * reading modifiers off a later render's event would read a different click.
   */
  onSelect?: (id: string | null, mode: SelectionMode) => void;
  /**
   * Everything else the renderer needs, passed through untouched.
   *
   * Spread rather than re-declared field by field: `PageRenderer` owns that
   * contract, and restating it here would be a second copy that silently stops
   * accepting whatever the renderer gains next.
   */
  render?: Omit<PageRendererProps, "document" | "siteStyles">;
  className?: string;
  /**
   * Pointer handlers for dragging blocks, from `useCanvasDrag`.
   *
   * Taken as an object rather than as individual props so the set cannot be
   * partially wired: a canvas carrying `onPointerDown` without `onPointerUp`
   * starts gestures it never ends, and the failure is a canvas that behaves
   * normally until the first drag.
   */
  dragHandlers?: CanvasDragHandlers;
  /**
   * The layout scale this canvas applies to the page it lays out.
   *
   * Defaults to fitting, so a host that offers no zoom control never has to
   * name a scale.
   */
  zoom?: CanvasZoom;
  /**
   * The scale the canvas is actually painting at, reported as it changes.
   *
   * On the CANVAS rather than on {@link CanvasProps.preview}, because the
   * scale is not a property of previewing a viewport: a site that declares no
   * tiers has no preview at all and is still laid out at some scale.
   *
   * Reported rather than exposed as state for the reason the width is: a
   * control computing its own would be a second answer to what is on screen,
   * and the two would disagree for the frame after a panel opens — which is
   * the moment worth naming.
   */
  onScale?: (scale: number) => void;
  /**
   * Raised when a double-click lands on the page.
   *
   * Separate from `onSelect` because the two gestures mean different things and
   * one handler deciding between them by counting clicks would be a second
   * place the distinction lives. A double-click that hits no editable value
   * does nothing, which the handler decides — the canvas does not know what is
   * editable.
   */
  onDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  /**
   * Editor chrome drawn ABOVE the page — the drop indicator today.
   *
   * Inside the root rather than beside it, because the overlay is positioned in
   * the canvas's own content coordinates and the root is what establishes them.
   * Rendered after the page so it paints on top without needing a stacking
   * context of its own.
   */
  overlay?: React.ReactNode;
}

/**
 * The canvas.
 *
 * Selection is addressed by node ID and never by position. The engine's document
 * makes ids the only addressing anything stores, and a positional selection
 * breaks the moment a sibling is inserted above it — silently, by pointing at a
 * different block rather than at nothing.
 */
export function Canvas({
  document,
  rootRef,
  onRoot,
  forcedState,
  siteStyles,
  selectedId = null,
  selectedIds,
  onSelect,
  render,
  className,
  dragHandlers,
  zoom = FIT_ZOOM,
  onScale,
  onDoubleClick,
  overlay,
  preview,
}: CanvasProps) {
  const root = useRef<HTMLDivElement | null>(null);

  /*
   * ONE assignment site for both publications.
   *
   * They are two APIs because they answer two questions — `rootRef` is read in
   * a pointer handler and asks "where is the canvas now"; `onRoot` is a value
   * so a reader can REACT to the canvas arriving, which a ref cannot express
   * because assigning `.current` changes no dependency. Neither can serve the
   * other's caller.
   *
   * But two effects deciding what the element is could drift: an edit to one is
   * invisible to the other, and the two would then hand out different answers
   * with nothing to report it. One effect, one element, published twice.
   *
   * After paint rather than through a merged ref callback: the element is the
   * same for the life of the mount, and one assignment here is easier to follow
   * than a callback keeping two refs agreeing.
   */
  useEffect(() => {
    const element = root.current;
    if (rootRef !== undefined) rootRef.current = element;
    onRoot?.(element);
    return () => {
      if (rootRef !== undefined) rootRef.current = null;
      onRoot?.(null);
    };
  }, [rootRef, onRoot]);

  /*
   * What to mark. The primary alone when a host has not adopted the set yet,
   * which keeps every existing caller correct without a change.
   */
  const marked = useMemo(
    () => markedIds(selectedIds, selectedId),
    [selectedIds, selectedId]
  );
  const pointer = useCanvasPointer(onSelect, onDoubleClick, marked);
  const dragPointerDown = dragHandlers?.onPointerDown;
  const canvasPointerDown = pointer.onPointerDown;
  const pointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragPointerDown?.(event);
      canvasPointerDown(event);
    },
    [canvasPointerDown, dragPointerDown]
  );

  // Keyed on the document identity so a re-render for an unrelated reason —
  // a selection change, a hover — does not rebuild the rendered tree.
  const { rendered, sheet, active } = usePreviewedInputs(
    render,
    siteStyles,
    preview
  );

  const boxStyle = useCanvasSurface(root, active, zoom, onScale);

  const page = useMemo(
    () => (
      <PageRenderer
        {...rendered}
        document={document}
        siteStyles={sheet}
        // What makes the hit-testing above possible at all. The renderer emits
        // the node attribute only when asked, because a PUBLISHED page should
        // not carry an editor's addressing — so the canvas asks and a route
        // does not. Spread first and set here deliberately: a caller passing
        // `nodeAttribute: false` through `render` would silently disable
        // selection for the whole canvas.
        nodeAttribute
      />
    ),
    [rendered, document, sheet]
  );

  useSelectionMarkers(root, marked, selectedId, page, forcedState);

  return (
    <div
      ref={root}
      className={cn(CANVAS_ROOT_CLASS, className)}
      // On the canvas ROOT rather than an inner wrapper, because the overlays
      // are positioned in this element's own content coordinates: a box inside
      // it would size the page while leaving the drop indicator and the
      // selection chrome measuring the region instead.
      style={boxStyle}
      // The id the canvas believes is current, for a caller that wants the
      // answer without walking the tree. Named apart from the per-element
      // marker deliberately: one carries an id and the other is a boolean, and
      // a single name meaning both is the kind of thing that reads correctly
      // right up until someone writes a selector against the wrong one.
      data-nx-selected-id={selectedId ?? undefined}
      onClick={pointer.onClick}
      onDoubleClick={pointer.onDoubleClick}
      onContextMenu={pointer.onContextMenu}
      // Spread whole, because the set cannot be partially applied — then the
      // one member this component also has something to say about is composed
      // over the top, drag first so its behaviour is exactly what it was.
      {...dragHandlers}
      onPointerDown={pointerDown}
    >
      {page}
      {overlay}
    </div>
  );
}
