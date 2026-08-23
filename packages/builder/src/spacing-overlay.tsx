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

import { CANVAS_ROOT_CLASS, nodeElement } from "./canvas";
import type { EditorState } from "./editor-state";
import { canvasContentRect, hasLayoutBox, renderedScale } from "./geometry-dom";
import {
  spacingBands,
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

export function SpacingOverlay({
  editor,
  hidden = false,
}: SpacingOverlayProps): React.JSX.Element | null {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const [bands, setBands] = React.useState<readonly SpacingBand[]>([]);

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
    const element = layer.current;
    if (element === null || selectedId === null) {
      setBands([]);
      return;
    }
    const root = element.closest(`.${CANVAS_ROOT_CLASS}`);
    if (!(root instanceof HTMLElement)) {
      setBands([]);
      return;
    }
    const block = nodeElement(root, selectedId);
    if (block === null) {
      setBands([]);
      return;
    }
    /*
     * A selected block that generates no box has nothing to draw around.
     *
     * `display: none` and `display: contents` are both catalog values and both
     * remain selectable through the Layers panel, which addresses nodes by id.
     * Their computed margin and padding stay whatever the author set while every
     * rectangle reads zero, so without this the bands appear at the canvas
     * origin describing space that is nowhere on screen.
     */
    if (!hasLayoutBox(block)) {
      setBands([]);
      return;
    }
    /*
     * The element's own view rather than the ambient `window`, so a canvas
     * rendered into another document is measured against the styles that
     * actually apply to it rather than against this one's.
     */
    const style = block.ownerDocument.defaultView?.getComputedStyle(block);
    if (style === undefined) {
      setBands([]);
      return;
    }

    const boxes = boxesOf(style);
    setBands(
      spacingBands({
        // Through `canvasContentRect` rather than a rectangle read here: this
        // package reads a rectangle in one place, so chrome measured one way
        // cannot disagree with chrome measured another at a scroll offset.
        border: canvasContentRect(block, root),
        borderWidths: boxes.borderWidths,
        margin: boxes.margin,
        padding: boxes.padding,
        /*
         * MEASURED from the element rather than assumed to be 1. `transform` is
         * a catalog property, so a scaled block makes the rectangle above and
         * the lengths beside it disagree — and asking the element carries any
         * scaled ancestor with it, which parsing its own transform would miss.
         */
        scale: renderedScale(block),
      })
    );
  }, [selectedId]);

  React.useLayoutEffect(() => {
    if (hidden) {
      setBands([]);
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
   * BOTH the block and the canvas root are watched, and the root is not
   * redundant. A `ResizeObserver` reports a size change, never a position one,
   * so a sibling ABOVE the selection finishing its own load moves the block
   * without resizing it and the block's own entry never fires. The root sizes to
   * its content, so that same reflow changes the root's height — which is the
   * observable event standing in for "something moved".
   *
   * The overlay itself cannot drive that loop: it is `position: absolute` filling
   * the root, so what it draws never contributes to the root's size.
   */
  React.useEffect(() => {
    if (hidden || selectedId === null) return;
    const element = layer.current;
    const root = element?.closest(`.${CANVAS_ROOT_CLASS}`);
    if (!(root instanceof HTMLElement)) return;
    // Absent in jsdom unless a test supplies one, and absent in older browsers.
    // A missing observer costs a re-measure, not correctness — every render
    // path above still measures.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    const block = nodeElement(root, selectedId);
    if (block !== null) observer.observe(block);
    return () => observer.disconnect();
    /*
     * `document` re-subscribes, and dropping it strands the observer on a
     * DETACHED element. An edit replaces the rendered tree while the selection
     * survives, so the id resolves to a NEW element and this effect — keyed on
     * the selection alone — would keep watching the old one. Its later resizes
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
