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
 * when the selected block resizes, and when the canvas root resizes. Between
 * them those cover an edit, an image or webfont arriving, the panels moving, and
 * a breakpoint changing — a breakpoint is driven by the canvas's own width, so
 * the root's resize is the event that reports it.
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

import { CANVAS_ROOT_CLASS, nodeElement, nodeElements } from "./canvas";
import type { EditorState } from "./editor-state";
import {
  canvasContentRect,
  canvasRootFrom,
  clippedByAncestor,
  hasScrollbarGutter,
  layoutFragments,
  renderedScale,
  type RenderedScale,
} from "./geometry-dom";
import {
  applicableEdges,
  overlayEscape,
  sameBands,
  spacingApplies,
  spacingBands,
  type EdgeApplicability,
  type EdgeLengths,
  type SpacingBand,
} from "./spacing-bands";

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
 * That second reason is applied PER AXIS, because the sides are independent:
 * `translateY(-4px)` — an ordinary hover lift — moves the top and bottom
 * margins and leaves the left and right ones exactly where they were. See
 * `selfMoved`, which reads the matrix rather than the declaration, so an
 * identity-valued transform keeps every band.
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
    top: applies.margin.top && !scale.selfMoved.y,
    bottom: applies.margin.bottom && !scale.selfMoved.y,
    left: applies.margin.left && !scale.selfMoved.x,
    right: applies.margin.right && !scale.selfMoved.x,
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
  position: string,
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
   */
  if (position === "fixed" || position === "sticky") return false;
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

export function SpacingOverlay({
  editor,
  hidden = false,
}: SpacingOverlayProps): React.JSX.Element | null {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const [bands, setBands] = React.useState<readonly SpacingBand[]>([]);
  /*
   * How far the layer may paint outside itself, in pixels.
   *
   * Held beside the bands rather than derived at render because it needs the
   * LAYER's size, which only the measurement has.
   */
  const [escape, setEscape] = React.useState(0);

  const { document, selectedId } = editor;

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
      layerBox?: { width: number; height: number }
    ): void => {
      setBands(current => (sameBands(current, next) ? current : next));
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
    if (
      !describable(
        layoutFragments(block),
        style.position,
        hasScrollbarGutter(block, borders),
        clippedByAncestor(block, root),
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
    const layerBox = canvasContentRect(root, root);
    apply(
      spacingBands({
        // Through `canvasContentRect` rather than a rectangle read here: this
        // package reads a rectangle in one place, so chrome measured one way
        // cannot disagree with chrome measured another at a scroll offset.
        border: canvasContentRect(block, root),
        borderWidths: boxes.borderWidths,
        margin: boxes.margin,
        padding: boxes.padding,
        // Composed from the real transform between the block and the root, so
        // a scaled ancestor counts and no rounded layout value is involved.
        scale: { x: scale.x, y: scale.y },
      }),
      layerBox
    );
  }, [selectedId]);

  React.useLayoutEffect(() => {
    if (hidden) {
      setBands(current => (current.length === 0 ? current : NO_BANDS));
      return;
    }
    measure();
    // `document` is not read by `measure` and is listed anyway: an edit resizes
    // the selected block, which is most of what the inspector does, and bands
    // keyed on the selection alone would keep describing the layout it had.
  }, [measure, hidden, document]);

  /*
   * Re-measure when the layout moves for a reason no render reports — an image
   * finishing, a webfont swapping, the panels being resized around the canvas.
   *
   * EVERY rendered node is observed, not just the selected one, because what
   * moves a block is another block changing size. A `ResizeObserver` reports a
   * size change and never a position one, so the selected block's own entry
   * stays silent while a sibling above it grows and pushes it down.
   *
   * Watching the canvas root does not stand in for this. The root is
   * `min-height: 100%`, so on a page shorter than the viewport it holds that
   * height and reports nothing however much the content inside it reflows — the
   * case where the bands would sit furthest from the block they name. The root
   * is still observed, for the resize the nodes cannot report: the panels moving
   * around the canvas, which changes the frame without changing any node.
   *
   * The overlay cannot drive its own loop: it is `position: absolute` filling the
   * root and carries no node marker, so nothing it draws is observed here or
   * contributes to the root's size.
   */
  React.useEffect(() => {
    if (hidden || selectedId === null) return;
    const element = layer.current;
    const root =
      element === null ? null : canvasRootFrom(element, CANVAS_ROOT_CLASS);
    if (root === null) return;
    /*
     * Each observer is guarded separately, and that is not tidiness. They answer
     * different questions — sizes changed, and the DOM changed — so a runtime
     * missing one must still get the other. Guarding both behind `ResizeObserver`
     * would silently drop mutation tracking wherever it is absent.
     *
     * Absent in jsdom unless a test supplies one, and absent in older browsers.
     * A missing observer costs a re-measure, not correctness — every render path
     * above still measures.
     */
    const sizes =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => measure());
    if (sizes !== null) {
      sizes.observe(root);
      for (const node of nodeElements(root)) sizes.observe(node);
    }

    /*
     * The other half: a change that alters computed style without altering any
     * size. A site-style save recompiles the sheet, and `PageRenderer` emits it
     * as a `<style>` INSIDE the page root — so the bytes changing is a mutation
     * in this subtree, where a resize observer has nothing to report because a
     * class-driven margin moves blocks without resizing them.
     *
     * Mutations inside the overlay's own layer are ignored. Drawing the bands is
     * itself a mutation of this subtree, so reacting to it would have the
     * measurement trigger the next measurement.
     */
    const styles =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(records => {
            const own = layer.current;
            const outside = records.some(
              record => own === null || !own.contains(record.target)
            );
            if (outside) measure();
          });
    styles?.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    /*
     * A transition moves geometry over time and emits nothing an observer sees:
     * `transition` is a catalog property, a transform or margin animating past
     * its first frame resizes nothing, and no DOM mutation accompanies the
     * frames. The completion events are what the browser does offer, and they
     * bubble, so one listener on the root covers every block.
     *
     * This corrects the FINAL geometry rather than following the animation.
     * Tracking the frames between would mean measuring on every one, which costs
     * more than a band being briefly behind a transition the author is watching.
     */
    const settled = (): void => measure();
    root.addEventListener("transitionend", settled);
    root.addEventListener("transitioncancel", settled);
    /*
     * `overflow: auto` and `overflow: scroll` are catalog values, so a block can
     * sit inside a container the author scrolls. Scrolling it moves the block
     * relative to the canvas while resizing nothing, mutating nothing and
     * finishing no transition — none of the subscriptions above hear it.
     *
     * CAPTURE, because a scroll event does not bubble: listening on the root in
     * the capture phase is what reaches a scroller nested anywhere inside it.
     */
    root.addEventListener("scroll", settled, true);

    return () => {
      sizes?.disconnect();
      styles?.disconnect();
      root.removeEventListener("transitionend", settled);
      root.removeEventListener("transitioncancel", settled);
      root.removeEventListener("scroll", settled, true);
    };
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
       * over it.
       *
       * Hidden from assistive technology because the same values are in the
       * inspector's Spacing section, with real labels and controls. Announcing
       * up to eight numbers on every arrow-key move through the layer tree would
       * bury that surface in exactly the readers it is for.
       */
      aria-hidden="true"
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
          style={{
            left: band.rect.x,
            top: band.rect.y,
            width: band.rect.width,
            height: band.rect.height,
          }}
        >
          <span className="nx-spacing-overlay__value">{band.label}</span>
        </div>
      ))}
    </div>
  );
}
