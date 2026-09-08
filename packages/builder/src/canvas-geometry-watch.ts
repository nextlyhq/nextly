/**
 * The one subscription that answers "a node's rectangle may have moved".
 *
 * Every overlay drawn in the canvas's content coordinates — the spacing bands,
 * the empty-container appenders — measures the nodes it draws over and has to
 * re-measure whenever the layout underneath it changes. React reports the
 * changes that come from a render; nothing reports the rest, and the rest is
 * several different mechanisms that no single browser API covers:
 *
 * - a SIZE change with no render behind it: a container query resolving at a
 *   new canvas width, a rail panel opening, a webfont swapping in, an image
 *   finishing its load. `ResizeObserver` is the only thing that sees these.
 * - a MOVE with no size change at all: a scroller between a node and the root,
 *   or a transition finishing on a neighbour. No observer reports either,
 *   because nothing resized, nothing mutated and no element the overlay knows
 *   about changed at all.
 *
 * Held here rather than written out per overlay because the drift is otherwise
 * silent and has already happened: one overlay subscribed to resizes and not
 * to scrolls, and its controls stayed at the coordinates the layout had before
 * the author scrolled a container — while the file looked like a complete copy
 * of the one beside it. A caller that asks this question asks all of it.
 *
 * A `MutationObserver` answers a THIRD question — the DOM changed, which alters
 * computed style without necessarily altering any size. It needs something the
 * other two do not, because the subtree it observes CONTAINS the overlay's own
 * output: where that output is, which only the overlay knows.
 *
 * {@link watchCanvasFor} is therefore the entry point and all three are behind
 * it, taking the one thing a caller has to supply. Offering the mechanisms
 * separately would put "did I remember to take all of them" back on each
 * overlay, which is the failure this module was extracted to remove and which
 * happened again the moment there were two subscriptions to remember instead of
 * one — an overlay took the geometry half, left the mutation half out, and its
 * controls stayed where a recompiled site sheet had moved the blocks from.
 *
 * @module canvas-geometry-watch
 */

import { nodeElements } from "./canvas";
import { canvasRootFrom } from "./geometry-dom";
import { CANVAS_ROOT_CLASS } from "./shell-state";

/**
 * Everything an overlay drawn over this canvas has to re-measure for.
 *
 * ONE call rather than a list a caller assembles: which changes can move a
 * rectangle is a single question, and an overlay that answers part of it looks
 * exactly like one that answers all of it — the file reads as complete and the
 * controls are simply stale under whichever mechanism was left out.
 *
 * The canvas root is resolved FROM the layer rather than passed in, so a caller
 * cannot subscribe against one root while drawing into another; `undefined`
 * comes back when there is none, which is an overlay mounted outside a canvas
 * and has nothing to watch.
 *
 * @param ownLayer - reads the caller's own layer element, and is read rather
 *   than passed because the layer does not exist until after the first render;
 *   it locates the canvas AND says which mutations are the caller's own
 * @param moved - re-measure; called once per change, never per frame
 * @returns unsubscribes everything this installed, or `undefined` when there
 *   was no canvas root to install anything on
 */
export function watchCanvasFor(
  ownLayer: () => HTMLElement | null,
  moved: () => void
): (() => void) | undefined {
  const element = ownLayer();
  const root =
    element === null ? null : canvasRootFrom(element, CANVAS_ROOT_CLASS);
  if (root === null) return undefined;
  const geometry = watchCanvasGeometry(root, moved);
  const styles = watchCanvasStyleMutations(root, ownLayer, moved);
  return () => {
    geometry();
    styles();
  };
}

/**
 * Call `moved` whenever the canvas's laid-out geometry may have changed.
 *
 * @param root - the canvas root every node is measured against
 * @param moved - re-measure; called once per change, never per frame
 * @returns unsubscribes everything this installed
 */
function watchCanvasGeometry(root: HTMLElement, moved: () => void): () => void {
  /*
   * EVERY rendered node is observed, not only the ones a caller draws over:
   * what moves a node is often a SIBLING changing size rather than the node
   * itself. An image finishing its load resizes that sibling and nothing else
   * — not the node laid out after it, and not the root, which is
   * `min-height: 100%` and can absorb the change while reporting nothing.
   *
   * The root is observed too, for the resize the nodes cannot report: the
   * panels around the canvas moving, which changes the frame without changing
   * any node.
   *
   * Absent in jsdom unless a test supplies one, and absent in older browsers.
   * Guarded on its own rather than gating the listeners below, because the two
   * answer different questions: a runtime missing the observer must still hear
   * a scroll. A missing observer costs a re-measure, not correctness — every
   * caller measures on render as well.
   */
  const sizes =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => moved());
  if (sizes !== null) {
    sizes.observe(root);
    for (const node of nodeElements(root)) sizes.observe(node);
  }

  /*
   * `overflow: auto` and `overflow: scroll` are catalog values, so a block can
   * sit inside a container the author scrolls. Scrolling it moves the block
   * relative to the canvas while resizing nothing, mutating nothing and
   * finishing no transition — none of the observers above hear it.
   *
   * CAPTURE, because a scroll event does not bubble: listening on the root in
   * the capture phase is what reaches a scroller nested anywhere inside it.
   *
   * `transition` is a catalog property too, and a transform or margin
   * animating past its first frame moves a block while resizing nothing. The
   * completion events are what the browser offers, and they DO bubble, so one
   * listener each on the root covers every block. This corrects the FINAL
   * geometry rather than following the animation: tracking the frames between
   * would mean measuring on every one, which costs more than an overlay being
   * briefly behind a transition the author is watching.
   */
  const settled = (): void => moved();
  root.addEventListener("transitionend", settled);
  root.addEventListener("transitioncancel", settled);
  root.addEventListener("scroll", settled, true);

  return () => {
    sizes?.disconnect();
    root.removeEventListener("transitionend", settled);
    root.removeEventListener("transitioncancel", settled);
    root.removeEventListener("scroll", settled, true);
  };
}

/**
 * Call `moved` when a mutation OUTSIDE the caller's own output lands in the
 * canvas.
 *
 * The change this reaches and {@link watchCanvasGeometry} cannot: a recompiled
 * site sheet. `PageRenderer` emits the sheet as a `<style>` inside the page
 * root, so a save mutates this subtree — and a class-driven margin, position or
 * transform then moves blocks while resizing nothing, scrolling nothing and
 * finishing no transition. Every subscription in the function above stays
 * silent, and an overlay drawn over one of those blocks keeps the coordinates
 * the old rule gave it until something else re-measures.
 *
 * SEPARATE from that function rather than folded into it, and this is the part
 * a caller has to supply. An overlay draws INTO the subtree being observed, so
 * every measurement mutates it — a control appearing or leaving is a
 * `childList` record, a new rectangle rewrites a `style` attribute — and an
 * observer that reacted to those would have each measurement schedule the next.
 * Which mutations are the caller's own is therefore not answerable here, which
 * is why it is an argument rather than a rule written into this module.
 *
 * The test applied to that answer IS shared, because both overlays give the
 * same one: a full-bleed layer of their own, so containment within it decides
 * ownership exactly. An overlay that drew into the page itself — inline
 * chrome attached to a block rather than a layer above it — could not be
 * answered by containment and should not use this.
 *
 * @param root - the canvas root whose subtree is watched
 * @param ownOutput - the caller's own layer, read at delivery time because it
 *   does not exist when the subscription is taken
 * @param moved - re-measure; called once per batch of foreign mutations
 * @returns unsubscribes
 */
function watchCanvasStyleMutations(
  root: HTMLElement,
  ownOutput: () => HTMLElement | null,
  moved: () => void
): () => void {
  // Absent in jsdom unless a test supplies one, and absent in older browsers.
  // A missing observer costs a re-measure rather than correctness: every caller
  // measures on render as well.
  if (typeof MutationObserver === "undefined") return () => {};
  const styles = new MutationObserver(records => {
    const own = ownOutput();
    /*
     * `own === null` counts as OUTSIDE rather than as the caller's own. The
     * layer is null only once the caller has unmounted, and an unmounted
     * overlay owns nothing in this subtree; treating it as own-output would
     * silently drop a real site-style change in any window where the reference
     * were momentarily unset.
     */
    const outside = records.some(
      record => own === null || !own.contains(record.target)
    );
    if (outside) moved();
  });
  /*
   * Every kind of record, because every kind can carry a new rule: a sheet
   * being replaced is `childList`, a sheet's bytes changing in place is
   * `characterData`, and a class or inline style moving on a block is
   * `attributes`. `subtree` because the sheet sits inside the page root rather
   * than beside it.
   */
  styles.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  return () => styles.disconnect();
}
