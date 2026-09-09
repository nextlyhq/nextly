/**
 * Which edge of a spacing band actually moves when the value grows.
 *
 * It is not a constant, and that is the whole reason this file exists. Measured
 * in Chromium on one ordinary block and one with a fixed height:
 *
 * | block | content edge | border edge |
 * | --- | --- | --- |
 * | height fits its content | stays | **moves outward** |
 * | height is fixed | **moves inward** | stays |
 *
 * So a handle placed on a fixed edge sits still while the block grows away from
 * it, and a drag direction derived from the wrong edge runs backwards. Both were
 * true of `padding-bottom` and `padding-right` on ordinary blocks, which is the
 * common case rather than an exotic one.
 *
 * ## Why this is measured rather than read off the CSS
 *
 * The question is whether the block's size along that axis is decided by its
 * content, and the ways a size becomes definite are open-ended: an explicit
 * `height`, a flex basis, a stretched grid area, an `aspect-ratio`, a fixed
 * parent with `align-items: stretch`. Enumerating them is the kind of list that
 * is complete until the next layout feature ships, and every gap is a handle
 * that runs backwards for a reason nobody can see. Asking the element is
 * complete by construction.
 *
 * MARGINS were once excluded from this on the reasoning that one lies outside
 * the border box and never moves it. That was wrong, and measured wrong the same
 * way: in normal flow and in a flex column alike, growing `margin-top` moves the
 * block's border edge DOWN while the outer margin edge — pinned by whatever
 * precedes it — stays exactly where it was. `margin-bottom` is the opposite, and
 * so the four sides do not agree with each other any more than the paddings do.
 *
 * | side | what moves |
 * | --- | --- |
 * | `margin-top`, `margin-left` | the border edge, INWARD |
 * | `margin-bottom`, `margin-right` | the outer edge, outward |
 *
 * The two boxes read the same probe in opposite directions, and that is not an
 * inconsistency but the geometry: a padding band's far edge from the block's
 * middle IS the border edge, and a margin band's far edge is the other one. So
 * the border edge moving means a padding grew outward and a margin grew inward.
 *
 * @module padding-response
 */

import { boxAcross } from "./geometry-dom";
import type { SpacingBox, SpacingSide } from "./spacing-bands";

/** How far the probe pushes the padding, in CSS pixels. */
const PROBE_PX = 10;

/**
 * The same property as a computed-style key.
 *
 * Read this way rather than through `getPropertyValue`, because that is how
 * every other reader in this package asks a computed style — `boxesOf` in the
 * overlay takes `style.paddingTop` — and asking a second way would be a second
 * shape for a test double to satisfy.
 */
const COMPUTED = {
  padding: {
    top: "paddingTop",
    right: "paddingRight",
    bottom: "paddingBottom",
    left: "paddingLeft",
  },
  margin: {
    top: "marginTop",
    right: "marginRight",
    bottom: "marginBottom",
    left: "marginLeft",
  },
} as const satisfies Record<SpacingBox, Record<SpacingSide, string>>;

/** How far the border edge on `side` moved away from the block's middle. */
function edgeMovedOut(
  before: DOMRect,
  after: DOMRect,
  side: SpacingSide
): number {
  switch (side) {
    case "top":
      return before.top - after.top;
    case "bottom":
      return after.bottom - before.bottom;
    case "left":
      return before.left - after.left;
    case "right":
      return after.right - before.right;
  }
}

/**
 * Ask the element which edge responds, by pushing its padding and looking.
 *
 * The inline value is restored EXACTLY — including the absence of one, and
 * including a priority the author set — so the document is byte-identical after
 * this returns. It has to be: this writes to a node the canvas is rendering, and
 * a probe that left a trace would be an edit nobody made.
 *
 * Synchronous throughout. The write, both reads and the restore happen in one
 * task, so no frame is ever painted with the probe value applied and no
 * `ResizeObserver` sees a size that differs from the one it last delivered.
 *
 * @param block - the rendered element the band was measured from
 * @param side - the physical side being asked about
 * @returns whether the OUTER edge is the one that moves
 */
export function spacingRespondsOutward(
  block: HTMLElement,
  box: SpacingBox,
  side: SpacingSide,
  scale: number
): boolean {
  const property = `${box}-${side}`;
  const style = block.style;
  /*
   * The WHOLE attribute, restored verbatim.
   *
   * Setting and then removing one property leaves `style=""` behind where there
   * was no attribute at all — invisible to rendering and perfectly visible to
   * the `MutationObserver` this canvas has watching its own subtree, which is
   * the difference between a probe and an edit. Saving the attribute also
   * carries the author's priority and property order for free, which restoring
   * one declaration by hand does not.
   */
  const had = block.getAttribute("style");
  const view = block.ownerDocument.defaultView;
  /* c8 ignore next -- an element outside a realm cannot be measured at all */
  if (view === null) return false;
  const current =
    Number.parseFloat(view.getComputedStyle(block)[COMPUTED[box][side]]) || 0;

  /*
   * Read through `geometry-dom`, which is the one module allowed to take a
   * rectangle off the DOM — `geometry-ownership.test.ts` enforces that, and the
   * reason is that two readers are each right about their own question and
   * disagree about the shared one.
   */
  const { before, after } = boxAcross(
    block,
    // `important`, so an author's own `!important` padding cannot win and make
    // every block answer "the outer edge never moves".
    () =>
      style.setProperty(
        property,
        `${String(current + PROBE_PX)}px`,
        "important"
      ),
    () => {
      if (had === null) block.removeAttribute("style");
      else block.setAttribute("style", had);
    }
  );

  /*
   * Judged against what the probe SHOULD have moved at this canvas's scale.
   *
   * `boxAcross` answers in viewport pixels, and the canvas is painted through a
   * transform — so ten CSS pixels of padding move the edge by ten times the
   * scale on screen, which is five at half zoom and two and a half at quarter.
   * A fixed threshold in viewport pixels therefore reads an ordinary
   * outward-growing block as stationary on any zoomed canvas, places the handle
   * on the edge that never moves and inverts the drag: exactly the defect this
   * module exists to remove, reintroduced by the units it was measured in.
   *
   * Half the expected motion separates the two answers cleanly, because the
   * other one is not a smaller movement — it is no movement at all.
   */
  const expected = PROBE_PX * (Number.isFinite(scale) && scale > 0 ? scale : 1);
  const borderEdgeMoved = edgeMovedOut(before, after, side) > expected / 2;
  /*
   * Read in opposite directions for the two boxes, because the border edge is
   * the far edge of a padding band and the NEAR edge of a margin one. A border
   * edge that moved outward therefore means a padding thickened away from the
   * block — and means a margin thickened toward it, since its own outer edge
   * stayed where whatever precedes it pinned it.
   */
  return box === "padding" ? borderEdgeMoved : !borderEdgeMoved;
}
