/**
 * Which way the element being edited runs, so a box of sides can be drawn true.
 *
 * A per-side property is stored in LOGICAL terms — block start, inline start —
 * and a box is a PHYSICAL picture. Turning one into the other is not a constant:
 * inline start is the left edge in a left-to-right context and the right edge
 * in Arabic or Hebrew, and in a vertical writing mode the block axis is
 * horizontal, so "block start" is a side rather than the top.
 *
 * The admin chrome is not the answer to that question. An author editing an
 * Arabic site in an English admin is looking at a left-to-right panel and a
 * right-to-left page, so a box oriented by the panel points at the opposite
 * edge from the one the value moves.
 *
 * ## The canvas answers, for the same reason it answers about the tag
 *
 * `renderedTagOf` in `style-subject` already takes this position: the canvas is
 * the page a visitor sees, so it cannot disagree with the cascade the browser
 * actually ran, and asking it needs no new field on the block contract. Writing
 * mode is if anything more clearly its question — it is inherited, so nothing
 * about the node alone decides it, and a site style or an ancestor block can
 * set it. Both questions therefore find the element the same way, through
 * `markedElementOf`.
 *
 * ## The CSS does the mapping, so no table of edges lives here
 *
 * The caller puts these values on the BOX so its grid resolves in the same
 * terms the element does: grid columns run along the inline axis and rows along
 * the block axis, so column one is the inline start in either direction and a
 * vertical mode transposes the pair. A hand-written map from logical side to
 * physical edge would be a second implementation of something CSS already does,
 * and would have to be kept in step with it.
 *
 * ## Unresolved is a THIRD answer, and it must not collapse into "left to right"
 *
 * The element may not be drawn yet — the canvas mounts after styles load, and a
 * block whose render returns a promise shows a fallback first. A reading that
 * fails is then indistinguishable from one that found a left-to-right element,
 * and the box would draw a confident picture of the wrong edges. So this
 * reports absence, and the caller draws four labelled rows instead, which name
 * their side in words and are true whichever way the element runs.
 *
 * @module side-orientation
 */
import { markedElementOf } from "./style-subject";

/** How the edited element runs, in the two properties a box grid needs. */
export interface SideOrientation {
  /** The element's `writing-mode`, which decides the axes. */
  readonly writingMode: string;
  /** The element's `direction`, which decides which end of the inline axis starts. */
  readonly direction: string;
}

/**
 * The orientation of the node's drawn element, or `undefined`.
 *
 * @param root - the canvas root the node is drawn under
 * @param nodeId - the block being edited
 * @returns the element's writing mode and direction, or `undefined`
 */
export function orientationOf(
  root: HTMLElement | null | undefined,
  nodeId: string | null
): SideOrientation | undefined {
  return orientationOfElement(markedElementOf(root, nodeId));
}

/**
 * The orientation of one element, or `undefined` when it cannot be read.
 *
 * @param element - the element to measure
 * @returns its writing mode and direction, or `undefined`
 */
export function orientationOfElement(
  element: Element | null | undefined
): SideOrientation | undefined {
  if (element === null || element === undefined) return undefined;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style === undefined) return undefined;
  const writingMode = style.writingMode;
  const direction = style.direction;
  /*
   * A style answering with neither is not a resolved element, and taking those
   * empty strings as "horizontal, left to right" is the silent default this
   * module exists to refuse. It is also the ordinary case under jsdom, which
   * computes neither property — so a unit test asserting the box appears is
   * asserting something only a real browser can produce, and the tests beside
   * this one stub the computed style rather than pretend otherwise.
   */
  if (writingMode === "" || direction === "") return undefined;
  return { writingMode, direction };
}
