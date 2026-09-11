"use client";

/**
 * The selected block's spacing, drawn on the page it applies to.
 *
 * An author setting margin or padding in the inspector is looking at the
 * canvas, not at the panel, and until now the only way to see what a value did
 * was to change it and watch the layout move. This draws the space itself:
 * a band over each side that has one, with the value written on it.
 *
 * ## The values come from the RENDERED page, not from the document
 *
 * `getComputedStyle` is the source, and the alternative — reading the stored
 * style tier the inspector edits — is wrong here in four separate ways, any one
 * of which is enough:
 *
 * - The catalog stores spacing per LOGICAL side (`margin-inline-start`), and a
 *   band is drawn on a PHYSICAL one. Which physical edge an inline side lands on
 *   depends on the element's inherited `direction` and `writing-mode`, so
 *   deriving it from the document means reimplementing a resolution rule the
 *   browser has already applied correctly.
 * - `auto` is a legal margin and has no value at all until layout runs — it is
 *   what centres a block.
 * - A percentage resolves against the containing block, which the document
 *   cannot see.
 * - The tier the inspector edits is not the whole cascade. A named class, a
 *   block-type default or a breakpoint override can win, and an overlay reading
 *   one tier would confidently name a value the page does not use.
 *
 * So the page is asked what it is doing, rather than a second opinion being
 * computed alongside it and drifting.
 *
 * ## The PRIMARY selection only
 *
 * Spacing belongs to a node; a multi-block selection has no margin of its own,
 * and drawing a set of bands per member leaves the numbers ambiguous about which
 * block each describes. The primary is the one the inspector answers for, so the
 * two surfaces agree about whose value is on screen.
 *
 * ## When it re-measures, and the one case it cannot see
 *
 * A re-measure happens when the selection changes, when the document changes,
 * and whenever `watchCanvasFor` reports that a rectangle may have moved.
 * Between them those cover an edit, an image or webfont arriving, the panels
 * moving, a scroller carrying the block, a transition settling, a recompiled
 * site sheet, and a breakpoint changing — a breakpoint is driven by the
 * canvas's own width, so the root's resize is the event that reports it.
 *
 * Which mechanisms the second of those owns is deliberately not restated here:
 * that list belongs to `canvas-geometry-watch.ts`, and a copy of it in this
 * docblock would be a second answer to fall out of step.
 *
 * What is NOT covered is a spacing change driven purely by a CSS STATE: a
 * `:hover` or `:focus-visible` rule altering a margin repaints without mutating
 * the DOM and without resizing anything, so there is no event for an observer to
 * receive — a `MutationObserver` sees nothing either, because nothing mutates.
 * Reaching it would mean re-measuring on pointer traffic across the canvas or
 * polling every frame, and both cost more than the staleness they remove. Stated
 * here rather than left to be discovered: while the pointer rests on a block
 * whose hover rule moves it, the bands describe its resting state.
 *
 * @module spacing-overlay
 */

import * as React from "react";

import {
  clipPathOf,
  scaleCornerRadii,
  SQUARE_CORNERS,
  usedCornerRadii,
  type CornerRadii,
} from "./border-radii";
import { BASE_BREAKPOINT } from "./breakpoints";
import { CANVAS_ROOT_CLASS, nodeElement } from "./canvas";
import { watchCanvasFor } from "./canvas-geometry-watch";
import type { EditorState } from "./editor-state";
import type { Rect, Scale } from "./geometry";
import {
  canvasContentRect,
  canvasPaintedScale,
  canvasRootFrom,
  clippedByAncestor,
  hasScrollbarGutter,
  layoutFragments,
  renderedScale,
  viewportPositioned,
  type RenderedScale,
} from "./geometry-dom";
import { orientationOfElement, type SideOrientation } from "./side-orientation";
import {
  applicableEdges,
  overlayEscape,
  sameBands,
  spacingApplies,
  spacingBands,
  type EdgeApplicability,
  type EdgeLengths,
  type SpacingBand,
  type SpacingBox,
  type SpacingSide,
} from "./spacing-bands";
import {
  SpacingHandles,
  type SpacingScrubContext,
  type SpacingSubject,
} from "./spacing-handles";
import { spacingRespondsOutward, styleCapable } from "./spacing-response";

export interface SpacingOverlayProps {
  /** The editor whose primary selection is measured. */
  editor: EditorState;
  /**
   * Suppress the bands, for a host that is mid-gesture.
   *
   * A drag is the case this exists for: the bands describe a layout that is in
   * the middle of changing, so every value on screen is about to be wrong.
   */
  hidden?: boolean;
  /**
   * The tier a handle writes to, and what the canvas compiled this page with.
   *
   * OPTIONAL, and its absence is not a neutral default. Omitted, a handle
   * writes the base breakpoint of the resting state through an unscoped,
   * default-prefixed preview — correct for an unscoped page at base, and wrong
   * in a way the author can see for anything else: `scrubPreviewCss` refuses a
   * non-base breakpoint it was given no set for, so the drag shows nothing
   * moving. A host that draws tiers or scopes must pass this.
   */
  scrub?: SpacingScrubContext;
}

/**
 * A computed length in pixels, or zero where the browser reports no number.
 *
 * `auto` is the case that reaches this. A computed margin is normally the used
 * value — a number even where the author wrote `auto` — but an element that is
 * not laid out has nothing to resolve against, and the string comes back
 * unresolved. Zero is the honest reading: there is no space to draw.
 */
function lengthOf(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The four physical margins, paddings and border widths of one element.
 *
 * PHYSICAL longhands rather than the logical ones the catalog stores, because a
 * band is drawn on a physical edge — and letting the browser resolve
 * `inline-start` to a side is the point, not an oversight.
 *
 * Spelled out one property at a time rather than assembled from a side name.
 * The computed style is a typed interface, and a name built at runtime turns
 * every one of these reads into an index lookup the checker cannot verify.
 */
function boxesOf(style: CSSStyleDeclaration): {
  margin: EdgeLengths;
  padding: EdgeLengths;
  borderWidths: EdgeLengths;
} {
  return {
    margin: {
      top: lengthOf(style.marginTop),
      right: lengthOf(style.marginRight),
      bottom: lengthOf(style.marginBottom),
      left: lengthOf(style.marginLeft),
    },
    padding: {
      top: lengthOf(style.paddingTop),
      right: lengthOf(style.paddingRight),
      bottom: lengthOf(style.paddingBottom),
      left: lengthOf(style.paddingLeft),
    },
    borderWidths: {
      top: lengthOf(style.borderTopWidth),
      right: lengthOf(style.borderRightWidth),
      bottom: lengthOf(style.borderBottomWidth),
      left: lengthOf(style.borderLeftWidth),
    },
  };
}

/**
 * The block's USED border-box corner radii, in LAYOUT pixels.
 *
 * A percentage radius resolves against the border box's own size, and the size
 * that governs is the one the element was LAID OUT at rather than the one it is
 * drawn at — `border-radius: 50%` on a block under `scale(2)` is half its layout
 * width, which then renders doubled like everything else inside the transform.
 *
 * That layout size is the measured rectangle divided back out by the scale it
 * was measured at, rather than a second reading from the element. `offsetWidth`
 * would answer the same question in whole pixels only, and `getComputedStyle`
 * reports whichever box `box-sizing` selects — so both are a second answer to a
 * question `renderedScale` has already answered exactly.
 *
 * A scale that is zero on either axis leaves nothing to resolve against and no
 * band to draw; `describable` refuses that block anyway, and answering square
 * here keeps this from dividing by it on the way to that refusal.
 *
 * UNDEFINED when a corner cannot be resolved at all — a percentage inside a
 * `calc()` stays unresolved in the computed value — which the caller treats as a
 * shape it cannot describe rather than as a square one.
 */
function radiiOf(
  style: CSSStyleDeclaration,
  border: Rect,
  scale: Scale
): CornerRadii | undefined {
  if (!(scale.x > 0) || !(scale.y > 0)) return SQUARE_CORNERS;
  return usedCornerRadii(
    {
      topLeft: style.borderTopLeftRadius,
      topRight: style.borderTopRightRadius,
      bottomRight: style.borderBottomRightRadius,
      bottomLeft: style.borderBottomLeftRadius,
    },
    { width: border.width / scale.x, height: border.height / scale.y }
  );
}

/**
 * The band's box, plus the clip its FILL takes when the block is rounded.
 *
 * The clip travels as a custom property rather than as this element's own
 * `clip-path` because the band carries the value chip, and the chip
 * deliberately overflows the band it names — the case where a number is hardest
 * to guess is the case where the space is too small to hold it. Clipping the
 * element would take the number with it, so the stylesheet applies the property
 * to the fill alone.
 */
function bandStyle(band: SpacingBand): React.CSSProperties {
  const box: React.CSSProperties = {
    left: band.rect.x,
    top: band.rect.y,
    width: band.rect.width,
    height: band.rect.height,
  };
  if (band.clip === undefined) return box;
  return {
    ...box,
    "--nx-spacing-clip": clipPathOf(band.clip),
  } as React.CSSProperties;
}

/**
 * Elements whose box is REPLACED by content the CSS box model does not lay out.
 *
 * Asked because a replaced inline box keeps its block-axis margins where a
 * non-replaced one drops them, and nothing in the computed style says which
 * kind a box is — `display` answers `inline` for both. It is the element type
 * that decides, so the element type is what this asks.
 *
 * Every member was measured, not assumed: forced to `display: inline` and given
 * a top and bottom margin, each one below moves the content after it by the
 * full amount, and `span`, `div` and `math` move it by nothing. `math` is the
 * surprise — MathML Core lays its box out like any other, so it is deliberately
 * absent rather than forgotten.
 *
 * A replaced element that is not currently rendering anything — an `<audio>`
 * with no controls, an `<embed>` with no type — generates no replaced box and
 * takes no block-axis margin, and this still calls it replaced. That is the
 * safer of the two errors: it draws a band for spacing the box takes the moment
 * it has something to show, where the other omits spacing that is in effect
 * right now.
 */
const REPLACED_TAGS: ReadonlySet<string> = new Set([
  "img",
  "iframe",
  "embed",
  "object",
  "video",
  "audio",
  "canvas",
  "svg",
  "input",
  "select",
  "textarea",
  "button",
  "progress",
  "meter",
]);

/** Whether this element's box is replaced. See {@link REPLACED_TAGS}. */
export function isReplaced(element: Element): boolean {
  /*
   * `localName` rather than `tagName`, which upper-cases an HTML element's name
   * but leaves an SVG one alone — so `<svg>` inside HTML answers `svg` to one
   * and `svg` to the other while `<img>` answers `img` and `IMG`. Comparing the
   * lower-cased local name is the spelling that holds for both.
   */
  return REPLACED_TAGS.has(element.localName.toLowerCase());
}

/**
 * The spacing this block can actually be drawn with, on each side.
 *
 * Two separate reasons zero a side, and they are both here so that no caller
 * can apply one and forget the other.
 *
 * The first is what CSS gives the generated box. `display: table-row` and the
 * internal ruby boxes take no margin, everything internal to a table except a
 * cell takes no padding, and a non-replaced inline box takes no block-axis
 * margin — while the computed style answers with whatever the author declared,
 * so reading it unconditionally draws bands for space that does not exist.
 *
 * The second is whether a band could be PUT there. A transform does not affect
 * layout: an ancestor's transform scales the subtree it lays out, gaps
 * included, so a margin inside one really does render smaller and `scale` is
 * right to apply it — but the block's OWN transform moves only its rendering,
 * while the space its margin reserves stays where the untransformed box left
 * it. Measured, a 100px block with `margin-bottom: 20px` under `scale(2)`
 * leaves a gap of MINUS eighty pixels, drawn over the neighbour that margin is
 * holding away, so no rectangle beside the rendered border edge describes it.
 *
 * That second reason is applied PER EDGE, because the sides are independent and
 * so are the two ends of one axis: `translateY(-4px)` — an ordinary hover lift —
 * moves the top and bottom margins and leaves left and right where they were,
 * while `translateY(-25px) scaleY(0.5)` pins the TOP edge and moves only the
 * bottom. See `selfMoved`, which asks whether each edge renders where it lays
 * out rather than inspecting the declaration.
 *
 * Padding is subject only to the first reason. It lies INSIDE the transform and
 * renders scaled with the box, so those bands stay correct on both axes.
 */
function drawableBoxes(
  style: CSSStyleDeclaration,
  block: Element,
  scale: RenderedScale
): { margin: EdgeLengths; padding: EdgeLengths; borderWidths: EdgeLengths } {
  const applies = spacingApplies(
    style.display,
    style.writingMode,
    isReplaced(block)
  );
  const margin: EdgeApplicability = {
    top: applies.margin.top && !scale.selfMoved.top,
    bottom: applies.margin.bottom && !scale.selfMoved.bottom,
    left: applies.margin.left && !scale.selfMoved.left,
    right: applies.margin.right && !scale.selfMoved.right,
  };
  const measured = boxesOf(style);
  return {
    borderWidths: measured.borderWidths,
    margin: applicableEdges(measured.margin, margin),
    padding: applicableEdges(measured.padding, applies.padding),
  };
}

/**
 * How far a value chip can overflow the band it is centred on.
 *
 * Bounded by the chip's own size, which this package sets: `0.6875rem` text on a
 * `1.4` line box with two pixels of padding, so a little over twenty pixels tall
 * and wider than that only for a value nobody authors. Twenty-four covers it
 * with room and keeps the clip allowance small.
 */
const CHIP_OVERFLOW_PX = 24;

/** One array identity for every empty result, so React can bail out of a render. */
const NO_BANDS: readonly SpacingBand[] = [];

/**
 * Whether axis-aligned bands can describe this block at all.
 *
 * One predicate rather than a guard per case, because every entry is the same
 * property: the rendered box is not a single upright rectangle sitting in the
 * canvas's own coordinates, so no rectangle pinned to a physical side describes
 * it and no scale factor rescues one that tries.
 *
 * Drawing nothing is the right answer for all of them. A band is read as a
 * MEASUREMENT, so one drawn in the wrong place is worse than an overlay that
 * declines to draw.
 */
function describable(
  fragments: number,
  viewportPositioned: boolean,
  gutter: boolean,
  clipped: boolean,
  scale: RenderedScale
): boolean {
  // No box at all — `display: none`, `display: contents`.
  if (fragments === 0) return false;
  /*
   * An inline box wrapped across lines. Its padding and margins belong to the
   * individual fragments while the bounding rectangle is their union, so bands
   * drawn from that union run through the whitespace between lines.
   */
  if (fragments > 1) return false;
  /*
   * Positioned against the viewport rather than the page. A sticky or fixed
   * block stops moving with the canvas content the bands are drawn in, so they
   * slide away from it on the first scroll — and scrolling emits no resize, so
   * nothing re-measures.
   *
   * Decided by `viewportPositioned` in `geometry-dom.ts` rather than by reading
   * `position` here, because it is a property of the coordinate space
   * `canvasContentRect` measures in and not of bands: every overlay drawn in
   * that space refuses the same elements, and a second copy of the test would
   * go on accepting a value the shared one had learned to refuse.
   */
  if (viewportPositioned) return false;
  /*
   * A classic scrollbar takes its width between the padding box and the border,
   * so a padding box derived from the borders alone is too wide by the gutter
   * and the band lands on the scrollbar. Which side it takes depends on the
   * writing direction.
   */
  if (gutter) return false;
  /*
   * Cut off by an ancestor. The block's own rectangle is reported unclipped and
   * the overlay draws outside that container, so bands taken from it would paint
   * over ground where the block is not rendered.
   */
  if (clipped) return false;
  // A rotation, skew, reflection, perspective, or a collapse to zero.
  return scale.describable;
}

/** The tier a handle writes to when the host names none. See `scrub`. */
const RESTING_BASE: SpacingScrubContext = {
  address: { state: "base", breakpoint: BASE_BREAKPOINT },
};

/**
 * Whether two measurements of the block describe the same gesture inputs.
 *
 * Compared by VALUE so a re-measure that found nothing moved does not hand the
 * handles a new object and restart every gesture they hold. `sameBands` already
 * does this for the bands; a subject compared by identity would defeat it.
 */
/** The four sides, for comparisons that must cover all of them. */
const SIDES: readonly SpacingSide[] = ["top", "right", "bottom", "left"];

function sameEdges(one: EdgeLengths, other: EdgeLengths): boolean {
  return (
    one.top === other.top &&
    one.right === other.right &&
    one.bottom === other.bottom &&
    one.left === other.left
  );
}

function sameScales(
  one: SpacingSubject["scales"],
  other: SpacingSubject["scales"]
): boolean {
  return (
    one.scale.x === other.scale.x &&
    one.scale.y === other.scale.y &&
    one.marginScale.x === other.marginScale.x &&
    one.marginScale.y === other.marginScale.y
  );
}

/**
 * Both unread, or both reading the same way.
 *
 * Optional chaining rather than a null branch: an unread orientation compares
 * equal to another unread one, which is right — neither draws a handle, so
 * nothing about the gesture layer differs between them.
 */
function sameOrientation(
  one: SideOrientation | undefined,
  other: SideOrientation | undefined
): boolean {
  return (
    one?.writingMode === other?.writingMode &&
    one?.direction === other?.direction
  );
}

function sameSubject(
  one: SpacingSubject | null,
  other: SpacingSubject | null
): boolean {
  if (one === null || other === null) return one === other;
  return (
    one.nodeId === other.nodeId &&
    sameEdges(one.margin, other.margin) &&
    sameEdges(one.padding, other.padding) &&
    sameScales(one.scales, other.scales) &&
    sameOrientation(one.orientation, other.orientation) &&
    /*
     * The probed answer is part of what a handle IS, so it belongs in this
     * comparison. An edit can turn a block from content-sized to fixed-sized
     * without changing a single measured length — the cache is re-probed and
     * answers differently, and a comparison blind to it would keep the old
     * subject: the handle stays on the edge that has stopped moving and the drag
     * keeps the direction that has stopped being right, until some unrelated
     * margin or scale change happens to force a replacement.
     *
     * NOT covered by a test of its own, and said here rather than left to be
     * discovered. What `outward` DOES once it reaches the handles is
     * covered — `spacing-handles.test.tsx` asserts both the edge it places the
     * control on and the direction it drags in. What is untested is this
     * propagation step: reaching it needs a measurement whose probe answers
     * differently while every other length holds still, and every attempt to
     * stage that in jsdom broke the measurement chain it was standing on. A
     * test that fights its harness is worth less than a note that does not.
     */
    (["margin", "padding"] as const).every(box =>
      SIDES.every(side => one.outward[box][side] === other.outward[box][side])
    )
  );
}

/**
 * The scale the probe's movement will be SEEN at, for one box on one side.
 *
 * A margin takes the ANCESTOR scale and a padding the composed one, and what
 * separates them is the element's OWN transform: a padding renders inside that
 * transform and scales with it, while a margin displaces the box in the
 * PARENT's coordinates, which the element's own transform never touches.
 * Measured in Chromium — under `scale(0.5)` on the block itself, a ten-pixel
 * margin probe still moves the edge ten pixels while a ten-pixel padding probe
 * moves it five.
 *
 * `renderedScale` already separates the two and says why, and `spacingDelta`
 * already divides by the matching one of the pair. Reading the composed scale
 * for both asks a question this package has answered and takes the wrong half
 * of the answer: on a transformed block the margin threshold then wants twice
 * the movement there is, reads a moving edge as pinned, and inverts the
 * handle.
 *
 * The root's own painted scale composes either way, because it is above the
 * element and applies to both boxes alike.
 */
export function probeScale(
  box: SpacingBox,
  side: SpacingSide,
  scale: RenderedScale,
  rootPainted: Scale
): number {
  const vertical = side === "top" || side === "bottom";
  const laidOutIn = box === "margin" ? scale.ancestor : scale;
  return (
    (vertical ? laidOutIn.y : laidOutIn.x) *
    (vertical ? rootPainted.y : rootPainted.x)
  );
}

export function SpacingOverlay({
  editor,
  hidden = false,
  scrub = RESTING_BASE,
}: SpacingOverlayProps): React.JSX.Element | null {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const [bands, setBands] = React.useState<readonly SpacingBand[]>([]);
  /*
   * What the gesture layer needs about the measured block, taken in the SAME
   * measurement the bands come from. Read separately it could disagree with
   * them — a drag scaled by one reading against bands drawn from another.
   */
  const [subject, setSubject] = React.useState<SpacingSubject | null>(null);
  /**
   * Whether the handles are holding a gesture that has not been released.
   *
   * A preview can make its own block undescribable — a margin can push it
   * partly behind an `overflow: hidden` ancestor, a padding can bring on a
   * classic scrollbar — and the measurement that follows then legitimately has
   * no bands to draw. Clearing the subject there unmounts the handles mid-drag:
   * the listeners detach, the preview disappears, and the gesture ends without
   * committing and without saying anything. The author sees the drag evaporate.
   *
   * So the SUBJECT survives while a gesture is live. The bands still go, which
   * is honest — nothing is measurable to report — but the control the pointer
   * is holding stays until it is let go.
   */
  const gestureLive = React.useRef(false);
  /*
   * How far the layer may paint outside itself, in pixels.
   *
   * Held beside the bands rather than derived at render because it needs the
   * LAYER's size, which only the measurement has.
   */
  const [escape, setEscape] = React.useState(0);

  const { document, selectedId } = editor;

  /*
   * Handles are drawn only for a SINGLE selection.
   *
   * `selectedId` is the primary of the selection, and a handle commits to that
   * node alone — so with six blocks outlined a drag would restyle one of them
   * and say nothing about the other five. `StyleInspectorPanel` refuses its
   * writable controls on the same reasoning, and a control on the canvas that
   * did what the panel beside it declines would be the same partial edit
   * reached by a route nobody thought to close.
   *
   * The BANDS stay. They report rather than write, and the primary's spacing is
   * a true thing to report about a selection that includes it.
   */
  const singular = editor.selection.ids.length <= 1;

  /*
   * Measured before the browser paints, so the bands never appear over the
   * position the block held on the previous render.
   *
   * Keyed on the document as well as the selection because an edit resizes the
   * block — which is most of what the inspector does — and bands keyed on the
   * selection alone would keep describing the layout it used to have.
   */
  const measure = React.useCallback(() => {
    const apply = (
      next: readonly SpacingBand[],
      layerBox?: { width: number; height: number },
      measured: SpacingSubject | null = null
    ): void => {
      setBands(current => (sameBands(current, next) ? current : next));
      setSubject(current => {
        // Never dropped out from under a live gesture. See `gestureLive`.
        if (measured === null && gestureLive.current) return current;
        return sameSubject(current, measured) ? current : measured;
      });
      setEscape(
        next.length === 0 || layerBox === undefined
          ? 0
          : overlayEscape(next, layerBox, CHIP_OVERFLOW_PX)
      );
    };
    const element = layer.current;
    if (element === null || selectedId === null) {
      apply(NO_BANDS);
      return;
    }
    // Resolved through `canvasRootFrom`, which answers in the ROOT's own realm —
    // see there for why `instanceof HTMLElement` is the wrong question.
    const root = canvasRootFrom(element, CANVAS_ROOT_CLASS);
    if (root === null) {
      apply(NO_BANDS);
      return;
    }
    const block = nodeElement(root, selectedId);
    if (block === null) {
      apply(NO_BANDS);
      return;
    }
    /*
     * The element's own view rather than the ambient `window`, so a canvas
     * rendered into another document is measured against the styles that
     * actually apply to it rather than against this one's.
     */
    const style = block.ownerDocument.defaultView?.getComputedStyle(block);
    if (style === undefined) {
      apply(NO_BANDS);
      return;
    }

    const scale = renderedScale(block, root);
    const boxes = drawableBoxes(style, block, scale);
    const borders = {
      x: boxes.borderWidths.left + boxes.borderWidths.right,
      y: boxes.borderWidths.top + boxes.borderWidths.bottom,
    };
    /*
     * Through `canvasContentRect` rather than a rectangle read here: this
     * package reads a rectangle in one place, so chrome measured one way cannot
     * disagree with chrome measured another at a scroll offset.
     */
    const border = canvasContentRect(block, root);
    const scaledBy: Scale = { x: scale.x, y: scale.y };
    const radii = radiiOf(style, border, scaledBy);
    /*
     * A block whose own radii cannot be resolved is a shape this cannot
     * describe, and drawing nothing is the answer it already gives for every
     * other one. Deciding it here rather than inside `describable` keeps that
     * predicate over the four values it is handed.
     */
    if (
      radii === undefined ||
      !describable(
        layoutFragments(block),
        viewportPositioned(block),
        hasScrollbarGutter(block, borders),
        /*
         * The block's own curve goes in with it: a rounded block flush inside an
         * equally rounded clipping container is not cut, while its bounding
         * rectangle's corners are outside every one of that container's arcs.
         *
         * Scaled, because the clip walk compares rendered rectangles while the
         * radii are resolved in layout pixels.
         */
        clippedByAncestor(block, root, scaleCornerRadii(radii, scaledBy)),
        scale
      )
    ) {
      apply(NO_BANDS);
      return;
    }

    /*
     * The layer's own box, measured the same way every other rectangle here is.
     * It fills the root, so the root's content rectangle IS the layer's, and
     * asking for it separately would be a second answer to one question.
     */
    /*
     * How much smaller than its layout the canvas is PAINTED, which is the unit
     * the probe's movement will be seen in. Read once per measurement.
     */
    const rootPainted = canvasPaintedScale(root);

    /**
     * This node's answer for one box and side, asked fresh on every measurement.
     *
     * NOT remembered between passes. The answer describes how the block responds
     * under the CSS applying to it right now, and what changes that CSS is
     * open-ended: an edit, a breakpoint re-resolving at a new canvas width, a
     * container query answering to a sibling's size, a forced state, a pointer
     * arriving and matching `:hover`. A remembered answer has to be dropped for
     * each of those in turn, which is a list that stays complete until the next
     * one — the same reasoning `spacing-response.ts` gives for asking the element
     * rather than reading the CSS. Measured at 0.8ms for all eight sides on a
     * fifteen-hundred-node page, which is the whole of what remembering saved.
     *
     * Asking every pass is only safe because the canvas ignores a batch of
     * mutations that changed nothing. The probe writes to a node this overlay's
     * own subscription watches and puts it back inside one task, so without that
     * filter each measurement would schedule the next forever. See
     * `changedNothing` in `canvas-geometry-watch.ts`.
     */
    const outwardFor = (box: SpacingBox, side: SpacingSide): boolean =>
      styleCapable(block)
        ? spacingRespondsOutward(
            block,
            box,
            side,
            probeScale(box, side, scale, rootPainted)
          )
        : false;

    const layerBox = canvasContentRect(root, root);
    apply(
      spacingBands({
        border,
        borderWidths: boxes.borderWidths,
        margin: boxes.margin,
        padding: boxes.padding,
        // Composed from the real transform between the block and the root, so
        // a scaled ancestor counts and no rounded layout value is involved.
        scale: scaledBy,
        // Margins take the ancestors' scale ALONE — a transform does not scale
        // the space a margin reserves, only the box it is drawn beside.
        marginScale: { x: scale.ancestor.x, y: scale.ancestor.y },
        // Resolved against the LAYOUT box, which is why the scale goes in with
        // it: a rounded block's bands have to be cut to the curve, and the curve
        // is stated in the units the author declared it in.
        radii,
      }),
      layerBox,
      {
        nodeId: selectedId,
        // The USED lengths, unscaled, which is what a handle starts a drag from
        // and what the band beside it already reports.
        margin: boxes.margin,
        padding: boxes.padding,
        scales: {
          scale: scaledBy,
          marginScale: { x: scale.ancestor.x, y: scale.ancestor.y },
        },
        /*
         * Read from the drawn element, and `undefined` when it cannot be. That
         * absence removes the handles rather than defaulting to left-to-right:
         * see `side-orientation.ts` on why an unread element and a
         * left-to-right one must not collapse into one answer.
         */
        orientation: orientationOfElement(block),
        /*
         * ASKED of the element, once per node and side, for BOTH boxes. Which
         * edge of a band moves depends on how the block's size and position are
         * settled along that axis, and no stored style answers that — a margin
         * no more than a padding. See `spacing-response.ts`.
         */
        outward: {
          margin: {
            top: outwardFor("margin", "top"),
            right: outwardFor("margin", "right"),
            bottom: outwardFor("margin", "bottom"),
            left: outwardFor("margin", "left"),
          },
          padding: {
            top: outwardFor("padding", "top"),
            right: outwardFor("padding", "right"),
            bottom: outwardFor("padding", "bottom"),
            left: outwardFor("padding", "left"),
          },
        },
      }
    );
    // The document is NOT one of these. Nothing here is remembered across a
    // measurement any more, so this reads the tree as it stands whenever it is
    // called; what makes it run again after an edit is the effect below, which
    // does depend on the document.
  }, [selectedId]);

  React.useLayoutEffect(() => {
    if (hidden) {
      setBands(current => (current.length === 0 ? current : NO_BANDS));
      // The subject goes with them. Left standing it would keep a handle's
      // gesture alive against a measurement nothing is drawing.
      setSubject(null);
      return;
    }
    measure();
    // `document` is NOT one of `measure`'s own dependencies — it reads the tree
    // as it stands — and is listed here because this effect is what has to run
    // again after an edit: an edit resizes the selected block, which is most of
    // what the inspector does, and an effect keyed on the selection alone would
    // leave the bands describing the layout it had.
  }, [measure, hidden, document]);

  /*
   * Re-measure when the layout moves for a reason no render reports — an image
   * finishing, a webfont swapping, the panels being resized around the canvas,
   * a scroller between a block and the root, a transition settling.
   *
   * That whole list is `watchCanvasFor`'s, shared with every other overlay
   * measuring against this root: which changes can move a rectangle is one
   * question, and a second copy of the answer drifts from the first silently —
   * the copy simply never hears one of the mechanisms, and looks complete.
   *
   * The layer is handed over as a READ rather than as an element, because it
   * does not exist yet on the first pass. It is what locates the canvas root,
   * and it is also what tells a foreign mutation from the bands' own: drawing
   * them mutates the very subtree being observed, so without it each
   * measurement would schedule the next.
   */
  React.useEffect(() => {
    if (hidden || selectedId === null) return;
    return watchCanvasFor(() => layer.current, measure);
    /*
     * `document` re-subscribes, and dropping it strands the observer on a
     * DETACHED element. An edit replaces the rendered tree while the selection
     * survives, so every id resolves to a NEW element and this effect — keyed on
     * the selection alone — would keep watching the old ones. Their later resizes
     * fire nothing, and the bands stay at the size the block had before the edit.
     */
  }, [measure, hidden, selectedId, document]);

  return (
    <div
      ref={layer}
      className="nx-spacing-overlay"
      /*
       * Not marked as chrome, for the reason the drop indicator is not: it takes
       * no pointer events at all, so a press travels through to the block
       * underneath and resolves to that node rather than to the overlay drawn
       * over it. The HANDLES inside it are marked, because they do take one.
       *
       * `aria-hidden` sits on each BAND rather than here, and that placement is
       * load-bearing. The bands are hidden for the same reason as ever — the
       * same values are in the inspector with real labels, and announcing up to
       * eight numbers on every arrow-key move through the layer tree would bury
       * that surface in exactly the readers it is for. The handles are
       * focusable, and a focusable element inside an `aria-hidden` subtree is
       * reachable by keyboard while screen readers are told it is not there.
       * One attribute on this element would have made every handle that.
       */
      /*
       * How far the clip may extend, measured rather than fixed. A band can
       * legitimately sit outside the canvas — a collapsed top margin does — and
       * any constant allowance is too small for some legal value.
       */
      style={
        { "--nx-spacing-escape": `${String(escape)}px` } as React.CSSProperties
      }
    >
      {bands.map(band => (
        <div
          key={`${band.box}-${band.side}`}
          className="nx-spacing-overlay__band"
          data-box={band.box}
          data-side={band.side}
          data-negative={band.negative ? "" : undefined}
          // See the layer above: the report is hidden, the control is not.
          aria-hidden="true"
          style={bandStyle(band)}
        >
          <span className="nx-spacing-overlay__value">{band.label}</span>
        </div>
      ))}
      {subject === null || !singular ? null : (
        <SpacingHandles
          editor={editor}
          bands={bands}
          subject={subject}
          context={scrub}
          /*
           * The measurement the preview needs, handed over as the callback the
           * bands are already measured by. See `onPreviewChange`: the layer's
           * own mutations are deliberately invisible to the style watcher, and
           * the scrub preview lives in that layer.
           */
          onPreviewChange={measure}
          /*
           * So a measurement that finds nothing to draw cannot unmount the
           * control the pointer is holding. See `gestureLive`.
           */
          onGestureChange={held => (gestureLive.current = held)}
        />
      )}
    </div>
  );
}
