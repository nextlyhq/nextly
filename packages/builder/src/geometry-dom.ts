/**
 * The one place a frame's inset is READ from the DOM.
 *
 * `geometry.ts` deliberately takes plain numbers so the mapping can be
 * exercised without a browser. That leaves one question it cannot answer, and
 * it is the question every caller gets wrong: which measurements add up to the
 * offset between a frame's border box and its content viewport.
 *
 * Answering it in prose did not work. The contract was documented as
 * `clientLeft`/`clientTop`, three call sites followed that recipe, and all
 * three were wrong by the padding — because an iframe's nested viewport begins
 * at the CONTENT box, so padding displaces it exactly as a border does. A
 * recipe a caller applies is a recipe a caller can misapply; a function they
 * call is not.
 *
 * Kept in its own module rather than folded into `geometry.ts` so that the
 * arithmetic stays testable without a DOM. This is the edge; that is the pure
 * part.
 *
 * @module geometry-dom
 */

import type { FrameInset } from "./geometry";

/**
 * How far a frame's content viewport sits inside its border box.
 *
 * Border plus padding, in the frame's own untransformed CSS pixels — which is
 * what {@link FrameInset} means and what `frameContentOrigin` scales.
 *
 * `clientLeft`/`clientTop` report the border alone. Padding comes from the
 * computed style because there is no element property that carries it, and a
 * non-pixel value (a percentage, `auto`) resolves to pixels there too.
 */
export function frameInsetOf(frame: HTMLIFrameElement): FrameInset {
  const style = frame.ownerDocument.defaultView?.getComputedStyle(frame);
  // A frame detached from its document has no view and therefore no computed
  // padding. Its border is still readable, so report what is knowable rather
  // than guessing a padding that would silently displace every mapped point.
  const paddingLeft = style === undefined ? 0 : parseFloat(style.paddingLeft);
  const paddingTop = style === undefined ? 0 : parseFloat(style.paddingTop);
  return {
    left: frame.clientLeft + (Number.isFinite(paddingLeft) ? paddingLeft : 0),
    top: frame.clientTop + (Number.isFinite(paddingTop) ? paddingTop : 0),
  };
}
