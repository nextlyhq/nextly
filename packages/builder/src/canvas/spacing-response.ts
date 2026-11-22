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
 * MARGINS look exempt, on the reasoning that one lies outside the border box
 * and never moves it. That reasoning fails the way any table of layout cases
 * fails — by arguing about layout instead of asking it. Measured in Chromium on
 * a block in normal flow, and again in a flex column:
 *
 * | band | border edge | outer margin edge |
 * | --- | --- | --- |
 * | `margin-top` | moves INWARD | pinned by what precedes it |
 * | `margin-left` | moves INWARD | pinned by the container |
 * | `margin-right`, auto width | moves INWARD | pinned by the container |
 * | `margin-right`, fixed width | pinned | moves outward |
 * | `margin-bottom` | pinned | moves outward |
 *
 * Exactly one of a margin band's two edges moves, so asking whether the BORDER
 * edge moved answers it: if it did, the outer edge is the pinned one. And the
 * question is not which SIDE — `margin-right` answers both ways depending on
 * whether the width is settled — which is why no table can stand in for asking.
 *
 * The two boxes therefore read the probe differently, and the difference is the
 * geometry rather than an inconsistency. A padding band's far edge from the
 * block's middle IS the border edge, and a padding can only push it outward, so
 * a padding is answered by SIGNED outward movement. A margin band's far edge is
 * the other one, and a margin drives the border edge either way, so a margin is
 * answered by whether it moved AT ALL.
 *
 * @module spacing-response
 */

import { boxAcross } from "./geometry-dom";
import type { SpacingBox, SpacingSide } from "./spacing-bands";

/** An element whose inline `style` this can write and put back. */
export type StyleCapableElement = Element & ElementCSSInlineStyle;

/**
 * Whether this element can be probed at all.
 *
 * Asked as a CAPABILITY rather than as `instanceof HTMLElement`, because the
 * blocks needing an answer are not all HTML: `isReplaced` counts `<svg>` among
 * the replaced boxes and `drawableBoxes` draws its margins, so an HTML-only
 * test answered every SVG-rooted block with a fallback instead of a
 * measurement — and a fallback is a direction supplied without measuring, which
 * is the thing this module exists to stop. An inline `style` is the whole
 * requirement, and HTML, SVG and MathML elements all carry one.
 */
export function styleCapable(element: Element): element is StyleCapableElement {
  return "style" in element;
}

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

/**
 * What to set `transition-property` to while the probe writes.
 *
 * Naming what is RUNNING rather than turning transitions off, because those are
 * different instructions and only one of them is safe. `transition: none` also
 * cancels whatever the block is in the middle of: measured in Chromium, a block
 * 0.28 of the way through an opacity transition jumps straight to 1 and stays
 * there, and restoring the attribute afterwards cannot resume a timeline that
 * has ended. A forced-state change starts exactly such a transition and then
 * mutates a class, which is what asks for a measurement — so the probe would
 * snap the animation it was prompted by.
 *
 * Listing the live transitions minus the probed property keeps each of them and
 * suppresses only the push about to be made. `transition-property: none` when
 * nothing is running cancels nothing, since there is nothing to cancel.
 *
 * Asked of the ELEMENT rather than of its declared `transition-property`, which
 * cannot answer it: `all` covers the probed property along with every other,
 * and no subtraction expresses "all except this one".
 */
function transitionsToKeep(block: Element, property: string): string {
  /* c8 ignore next -- jsdom animates nothing, so it publishes no timelines */
  if (typeof block.getAnimations !== "function") return "none";
  const running = block
    .getAnimations()
    .map(animation =>
      "transitionProperty" in animation
        ? String(animation.transitionProperty)
        : ""
    )
    .filter(name => name !== "" && name !== property);
  return running.length === 0 ? "none" : [...new Set(running)].join(", ");
}

/**
 * Let the browser settle the style written so far, by reading through it.
 *
 * A pair of writes in one task otherwise lands in a single recalculation, and
 * a transition then sees the wrong value as the one it starts from. Computed
 * style rather than a rectangle: it flushes just the same, and a rectangle read
 * belongs to `geometry-dom`, which owns that question for this package.
 */
function settle(
  view: Window,
  block: Element,
  computed: keyof CSSStyleDeclaration
): void {
  const styles = view.getComputedStyle(block);
  // Read into nothing on purpose: the READ is the effect being asked for.
  if (styles[computed] === undefined) return;
}

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
  block: StyleCapableElement,
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
  const computed = COMPUTED[box][side];
  const current =
    Number.parseFloat(view.getComputedStyle(block)[computed]) || 0;
  const keep = transitionsToKeep(block, property);

  /** The element's own inline style, exactly as it was found. */
  const release = (): void => {
    if (had !== null) {
      block.setAttribute("style", had);
      return;
    }
    block.removeAttribute("style");
    /*
     * Removed TWICE, with a read between, and only the read makes the second
     * one work.
     *
     * Measured in Chromium: an element that had no `style` attribute is left
     * carrying `style=""` after one removal, because the declaration this probe
     * dirtied is re-serialised back into the attribute. Calling
     * `removeAttribute` twice in a row does not help — nothing between them
     * forces that pending write to happen — while asking whether the attribute
     * is there does, so the removal after it clears the attribute for real.
     *
     * It matters because the canvas watches this subtree: an empty `style`
     * attribute is invisible to rendering and perfectly visible to a
     * `MutationObserver`, which is the difference between a probe and an edit
     * nobody made. jsdom removes the attribute on the first call, so no test in
     * this package can tell the two apart; only a browser can.
     */
    if (block.hasAttribute("style")) block.removeAttribute("style");
  };

  /*
   * Read through `geometry-dom`, which is the one module allowed to take a
   * rectangle off the DOM — `geometry-ownership.test.ts` enforces that, and the
   * reason is that two readers are each right about their own question and
   * disagree about the shared one.
   */
  const { before, after } = boxAcross(
    block,
    () => {
      /*
       * The probed property must not transition, and it is the difference
       * between a measurement and a reading of nothing.
       *
       * `transition` is a catalog property, so a block may carry one over the
       * very side being probed — and then the push does not land, it begins to
       * animate. Measured in Chromium: with `transition: margin-top 2s`, the
       * edge moves ZERO pixels in the same task, so the probe reads a block
       * whose margin responds as one that does not, places the handle on the
       * pinned edge and inverts the drag. Writing the declaration at important
       * priority does not help, because priority decides the cascade rather
       * than whether a transition runs.
       *
       * An ANIMATION needs nothing here and gets nothing: measured the same
       * way, a running keyframe animation over the same property answers
       * correctly either way, because an author declaration at important
       * priority outranks an animation in the cascade.
       *
       * Restored with everything else: the whole attribute goes back verbatim.
       */
      style.setProperty("transition-property", keep, "important");
      // `important`, so an author's own `!important` padding cannot win and
      // make every block answer "the outer edge never moves".
      style.setProperty(
        property,
        `${String(current + PROBE_PX)}px`,
        "important"
      );
    },
    () => {
      /*
       * Put the VALUE back while the transition is still suppressed, and only
       * then let the transition back.
       *
       * Restoring both at once starts the very animation the suppression was
       * for, in reverse. The measurement above has already committed the probed
       * value — that is what reading the rectangle does — so a restore that
       * also re-enables the author's transition presents a transitionable change
       * FROM the probed value back to the real one. Measured in Chromium on a
       * block with `transition: margin-top 2s`: after one probe the computed
       * margin reads thirty pixels, and the block spends two seconds sliding
       * back to twenty from a value nobody wrote. Eight probes make that eight
       * properties, on nothing more than a selection.
       */
      release();
      style.setProperty("transition-property", keep, "important");
      settle(view, block, computed);
      // The value is already back, so this changes nothing that can transition.
      release();
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
  const moved = edgeMovedOut(before, after, side);
  /*
   * A padding is asked whether the border edge moved OUTWARD, because that edge
   * is the far one of its band and a padding cannot pull it inward: growing one
   * either pushes the border edge out or is absorbed by a size already settled.
   */
  if (box === "padding") return moved > expected / 2;
  /*
   * A margin is asked whether that edge moved AT ALL, and the sign is the trap.
   * `margin-top` drives the border edge DOWN — inward, which reads NEGATIVE here
   * — so a SIGNED comparison files it under "did not move", concludes the outer
   * edge is the live one, and puts the handle on the very edge this module
   * exists to avoid. A border edge that moved means the outer one is pinned, and
   * so the band grows inward.
   */
  return Math.abs(moved) <= expected / 2;
}
