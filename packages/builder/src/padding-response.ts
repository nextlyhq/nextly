/**
 * Which edge of a padding band actually moves when the value grows.
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
 * MARGINS need none of this. A margin lies outside the border box and never
 * moves it — growing one pushes the neighbour, not the block — so its band
 * always thickens away from the block, and a negative one always thickens
 * inward. That is structural, so it stays a table.
 *
 * @module padding-response
 */

import { boxAcross } from "./geometry-dom";
import type { SpacingSide } from "./spacing-bands";

/** How far the probe pushes the padding, in CSS pixels. */
const PROBE_PX = 10;

/** Half the probe, as the threshold a real response has to clear. */
const MOVED_PX = PROBE_PX / 2;

/** The inline property one side's padding is written through. */
const PROPERTY: Record<SpacingSide, string> = {
  top: "padding-top",
  right: "padding-right",
  bottom: "padding-bottom",
  left: "padding-left",
};

/**
 * The same property as a computed-style key.
 *
 * Read this way rather than through `getPropertyValue`, because that is how
 * every other reader in this package asks a computed style — `boxesOf` in the
 * overlay takes `style.paddingTop` — and asking a second way would be a second
 * shape for a test double to satisfy.
 */
const COMPUTED: Record<
  SpacingSide,
  "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft"
> = {
  top: "paddingTop",
  right: "paddingRight",
  bottom: "paddingBottom",
  left: "paddingLeft",
};

/** Whether the border edge on `side` moved away from the block's middle. */
function edgeMovedOut(
  before: DOMRect,
  after: DOMRect,
  side: SpacingSide
): boolean {
  switch (side) {
    case "top":
      return before.top - after.top > MOVED_PX;
    case "bottom":
      return after.bottom - before.bottom > MOVED_PX;
    case "left":
      return before.left - after.left > MOVED_PX;
    case "right":
      return after.right - before.right > MOVED_PX;
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
export function paddingRespondsOutward(
  block: HTMLElement,
  side: SpacingSide
): boolean {
  const property = PROPERTY[side];
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
    Number.parseFloat(view.getComputedStyle(block)[COMPUTED[side]]) || 0;

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

  return edgeMovedOut(before, after, side);
}
