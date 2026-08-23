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

import type { FrameInset, Point, Rect } from "./geometry";

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

/**
 * A rectangle in the canvas's own CONTENT coordinates.
 *
 * The space the editor's chrome is drawn in: the origin is the canvas root's
 * top-left, and scrolling the root does not move it. `getBoundingClientRect`
 * answers in VIEWPORT coordinates, which move with every scroll and with the
 * page's own layout — so a rectangle stored raw is only correct until something
 * scrolls, and the symptom is an overlay that drifts rather than one that is
 * plainly wrong.
 *
 * Adding the root's scroll is what makes the result stable, and it is also what
 * makes it the same space an absolutely positioned child of the root resolves
 * against: such a child is placed relative to the padding box with scroll
 * included. So a rectangle measured here can be handed straight to `style.top`
 * and lands on what was measured.
 */
export function canvasContentRect(element: Element, root: HTMLElement): Rect {
  const box = element.getBoundingClientRect();
  const rootBox = root.getBoundingClientRect();
  return {
    x: box.x - rootBox.x + root.scrollLeft,
    y: box.y - rootBox.y + root.scrollTop,
    width: box.width,
    height: box.height,
  };
}

/**
 * A viewport point in the canvas's own content coordinates.
 *
 * The exact counterpart of {@link canvasContentRect} rather than a second
 * mapping written to match: a pointer event arrives in viewport coordinates and
 * has to be compared against rectangles measured above, and the two disagreeing
 * by a scroll offset is the fault this pairing exists to prevent.
 */
export function canvasContentPoint(
  clientX: number,
  clientY: number,
  root: HTMLElement
): Point {
  const rootBox = root.getBoundingClientRect();
  return {
    x: clientX - rootBox.x + root.scrollLeft,
    y: clientY - rootBox.y + root.scrollTop,
  };
}

/**
 * The nearest ancestor that actually scrolls, or `null` when nothing does.
 *
 * The canvas root is NOT it. That element carries the drag handlers and sizes
 * itself to its content — `overflow: visible` — so assigning `scrollTop` on it
 * is silently ignored, and an autoscroll written against it does nothing on a
 * page long enough to need one. The scrolling is done by an ancestor the shell
 * owns, which is where the visible window's edges live too.
 *
 * Matched on the COMPUTED overflow rather than on whether the element currently
 * overflows. A container is the scroller because of how it is styled, not
 * because of how much happens to be in it right now — testing the current
 * amount would answer "no" for an empty canvas and change its mind once a block
 * was added, which is a different element for the same drag.
 *
 * Starts at the root's parent: the root is excluded by definition, since it is
 * the thing being scrolled WITHIN.
 */
export function scrollableAncestor(root: HTMLElement): HTMLElement | null {
  let element = root.parentElement;
  while (element !== null) {
    const overflowY = getComputedStyle(element).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return element;
    element = element.parentElement;
  }
  return null;
}

/**
 * The container's top and bottom edges, in CLIENT coordinates.
 *
 * Client rather than content, because the only caller compares them against a
 * pointer's client position to decide whether it is resting near an edge. That
 * question is about where the container sits on SCREEN, and converting either
 * side into content space would answer a different one — a container scrolled
 * halfway down its content has the same edges on screen as one scrolled to the
 * top.
 *
 * Here rather than at the caller because this module is the one place allowed to
 * read layout from the DOM, and a guard enforces it. The rule is worth the
 * indirection: every reflow-forcing read being in one file is what makes the
 * cost of one findable.
 */
export function containerEdges(root: HTMLElement): {
  top: number;
  bottom: number;
} {
  const box = root.getBoundingClientRect();
  return { top: box.top, bottom: box.bottom };
}

/**
 * How many layout boxes an element generates.
 *
 * `display: none` and `display: contents` are both catalog values, and an
 * element carrying either can still be SELECTED — the Layers panel addresses
 * nodes by id and does not require them to be visible. Neither generates a box,
 * so every rectangle read from one is the zero rectangle, while its computed
 * margin and padding stay whatever the author set. Chrome positioned from that
 * pair lands at the canvas origin describing spacing that is nowhere on screen.
 *
 * ZERO means the element generates no box: `display: none` and
 * `display: contents` both reach it. `getClientRects` is the direct question
 * rather than a proxy, because a zero-SIZED rectangle is also what a genuinely
 * empty block reports and `core/spacer` legitimately has one — an element that
 * generates no box returns no rectangles at all.
 *
 * MORE THAN ONE means an inline box fragmented across lines. Its padding and
 * margins belong to the individual fragments while `getBoundingClientRect`
 * reports their union, so a band drawn from that union runs through the
 * whitespace between lines and puts the start and end padding on the union's
 * edges rather than on the first and last fragment.
 *
 * Here because this module is the one place allowed to read a rectangle from the
 * DOM, and a sibling guard enforces it by name.
 */
export function layoutFragments(element: Element): number {
  return element.getClientRects().length;
}

/**
 * The cumulative transform between an element and the canvas root, reduced to
 * the two things axis-aligned chrome can use.
 *
 * `transform` is a catalog property taking a free-form CSS value, so an author
 * can scale, rotate, skew or MIRROR a block. Everything measured through
 * `getBoundingClientRect` is post-transform while every length from
 * `getComputedStyle` stays in unscaled CSS pixels, and anything combining the
 * two is wrong by whatever sits between them.
 *
 * ## Read from the matrix rather than inferred from a ratio
 *
 * Comparing the drawn box against `offsetWidth` looks equivalent and is not, in
 * three ways that all read as ordinary code:
 *
 * - `offsetWidth` is INTEGER-ROUNDED and a bounding rectangle is not, so an
 *   untransformed block of fractional width reports a scale it does not have —
 *   worst at exactly the small sizes where a band is hardest to judge by eye.
 * - A bounding rectangle is never negative, so `scaleX(-1)` divides out to an
 *   ordinary positive factor and the mirroring vanishes from the answer.
 * - A rotation or skew inflates the bounding box, so the ratio reports a scale
 *   that describes no axis at all.
 *
 * The matrix has none of those: it is exact, it is signed, and its off-diagonal
 * terms are what a rotation or skew shows up in.
 *
 * ## `describable` is a refusal, not a detail
 *
 * A band is an axis-aligned rectangle pinned to a physical side. That
 * representation has no meaning for a rotated, skewed or mirrored box — a left
 * margin on a mirrored element renders on the RIGHT — and no choice of scale
 * factor rescues it. So the answer carries whether the question is askable, and
 * chrome that cannot draw the truth draws nothing rather than something
 * confident and wrong.
 *
 * Composed up to the ROOT rather than read off the element, because a scaled
 * ancestor moves and resizes its descendants while their own transform stays
 * `none`.
 */
export interface RenderedScale {
  readonly x: number;
  readonly y: number;
  /** False for a rotation, a skew, a reflection, or a collapse to zero. */
  readonly describable: boolean;
}

const IDENTITY_SCALE: RenderedScale = { x: 1, y: 1, describable: true };

export function renderedScale(element: Element, root: Element): RenderedScale {
  const view = element.ownerDocument.defaultView;
  // Absent in jsdom, which lays nothing out and so has no transform to compose.
  // Identity is the honest answer there: nothing is scaled because nothing is
  // laid out, and every caller still measures.
  if (view === null || typeof view.DOMMatrix === "undefined") {
    return IDENTITY_SCALE;
  }

  let matrix = new view.DOMMatrix();
  /*
   * Stops BELOW the root, which is not an off-by-one.
   *
   * The overlay is a child of the root, so it is inside whatever transform the
   * root carries and is drawn through it already. Composing the root's own
   * transform here would apply it a second time — the bands would be scaled by
   * its square while the page was scaled by it once.
   */
  for (
    let node: Element | null = element;
    node !== null && node !== root;
    node = node.parentElement
  ) {
    const declared = view.getComputedStyle(node).transform;
    if (declared === "" || declared === "none") continue;
    matrix = new view.DOMMatrix(declared).multiply(matrix);
  }

  /*
   * `b` and `c` are the off-diagonal terms: zero for any composition of
   * translations and axis-aligned scales, non-zero the moment a rotation or a
   * skew enters.
   *
   * `is2D` is a separate question and a 2D check does not imply it. A
   * `perspective(500px) rotateY(30deg)` projects the box as a trapezoid whose
   * scale varies across it, and the flattened matrix can still show zero
   * off-diagonal terms with positive `a` and `d` — describable by those tests
   * and describable by nothing that draws rectangles.
   */
  const axisAligned = matrix.is2D && matrix.b === 0 && matrix.c === 0;
  return {
    x: matrix.a,
    y: matrix.d,
    describable: axisAligned && matrix.a > 0 && matrix.d > 0,
  };
}

/**
 * Whether a classic scrollbar reserves space inside the element's border box.
 *
 * `overflow: auto` and `overflow: scroll` are catalog values, and on a platform
 * without overlay scrollbars the scrollbar takes its width from BETWEEN the
 * padding box and the border — so a padding box derived by removing only the
 * borders is too wide by the gutter, and the right or bottom padding band is
 * drawn over the scrollbar instead of over the padding. Which side it takes is
 * a function of the writing direction, so a right-hand assumption is wrong in
 * RTL.
 *
 * `clientWidth` excludes both the border and the gutter while `offsetWidth`
 * excludes neither, so their difference beyond the borders IS the gutter. Both
 * are integer-rounded, hence the half-pixel threshold: a real scrollbar is
 * around fifteen pixels and sub-pixel layout noise is never that.
 *
 * Reported rather than corrected. The caller declines a block whose padding
 * geometry cannot be represented, which is one rule it already applies to
 * several other shapes.
 */
export function hasScrollbarGutter(
  element: Element,
  borders: { x: number; y: number }
): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const view = element.ownerDocument.defaultView;
  if (view === null) return false;

  /*
   * Only a scroll container can reserve one, and asking anything else is not
   * merely wasted — it is WRONG. `clientWidth` and `clientHeight` are defined as
   * zero for an element with no CSS layout box in the usual sense, which
   * includes every inline box, so the subtraction below reports the element's
   * whole width as a gutter and an ordinary inline block is refused for a
   * scrollbar it could not have.
   */
  const style = view.getComputedStyle(element);
  const scrolls = (overflow: string): boolean =>
    overflow === "auto" || overflow === "scroll";
  if (!scrolls(style.overflowX) && !scrolls(style.overflowY)) return false;

  const gutterX = element.offsetWidth - element.clientWidth - borders.x;
  const gutterY = element.offsetHeight - element.clientHeight - borders.y;
  return gutterX > 0.5 || gutterY > 0.5;
}
