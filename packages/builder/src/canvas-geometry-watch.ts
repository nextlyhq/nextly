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
 * What is deliberately NOT here: a `MutationObserver`. It answers a different
 * question — the DOM CHANGED, which includes changes an overlay makes by
 * drawing itself — so a caller adopting it needs its own rule for which
 * mutations are its own, and that rule cannot be shared. `spacing-overlay.tsx`
 * keeps one beside this call for exactly that reason.
 *
 * @module canvas-geometry-watch
 */

import { nodeElements } from "./canvas";

/**
 * Call `moved` whenever the canvas's laid-out geometry may have changed.
 *
 * @param root - the canvas root every node is measured against
 * @param moved - re-measure; called once per change, never per frame
 * @returns unsubscribes everything this installed
 */
export function watchCanvasGeometry(
  root: HTMLElement,
  moved: () => void
): () => void {
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
