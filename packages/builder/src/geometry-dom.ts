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

import type { CornerRadii, EdgeBounds } from "./border-radii";
import {
  insetCornerRadii,
  isSquare,
  roundedInsideRounded,
  scaleCornerRadii,
  usedCornerRadii,
} from "./border-radii";
import type { FrameInset, Point, Rect, Scale } from "./geometry";

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
 * How much smaller the canvas is PAINTED than it is laid out, per axis.
 *
 * The editor scales the canvas so a tier wider than the region can still be
 * edited, and a transform is paint-time: the root stays its requested width to
 * layout — which is what keeps the container queries resolving at the tier the
 * author asked for — while `getBoundingClientRect` answers in painted pixels.
 * A distance taken from client rectangles is therefore in a different unit from
 * the content coordinates the chrome is placed in, and the two agree only at
 * 100%. That is the shape this module's own header warns about: an error of
 * `(1 - scale)` times the distance, exactly zero while nothing is scaled and
 * growing as the canvas zooms out, so every test at default scale passes.
 *
 * Measured from the ROOT rather than read from its `transform`, because the
 * scale may be applied by an ancestor the canvas does not own and a declaration
 * read off one element cannot see that. The ratio is true wherever it came
 * from.
 *
 * `1` when nothing has been laid out — jsdom, or a root not yet in the
 * document — which is the identity the callers below already assume, so an
 * unmeasurable canvas behaves exactly as it did before there was a scale.
 */
function paintedScale(root: HTMLElement, painted: DOMRect): Scale {
  const width = root.offsetWidth;
  const height = root.offsetHeight;
  return {
    x: width > 0 && painted.width > 0 ? painted.width / width : 1,
    y: height > 0 && painted.height > 0 ? painted.height / height : 1,
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
  const scale = paintedScale(root, rootBox);
  return {
    // The SCROLL is added after the division, not inside it. A scroll offset is
    // already in content pixels — it counts the element's own laid-out content,
    // which a transform never touches — so dividing it would shrink a real
    // offset by the zoom and drift the whole overlay as the page is scrolled.
    x: (box.x - rootBox.x) / scale.x + root.scrollLeft,
    y: (box.y - rootBox.y) / scale.y + root.scrollTop,
    width: box.width / scale.x,
    height: box.height / scale.y,
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
  const scale = paintedScale(root, rootBox);
  return {
    x: (clientX - rootBox.x) / scale.x + root.scrollLeft,
    y: (clientY - rootBox.y) / scale.y + root.scrollTop,
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
  /**
   * The physical edges the element's OWN transform draws away from their layout
   * position.
   *
   * Separated from the composed scale because the two do OPPOSITE things to a
   * margin. **A transform does not affect layout.** An ancestor's transform
   * scales the whole subtree it lays out, gaps included, so a margin inside one
   * really does render smaller and `x`/`y` above are right to apply. The
   * element's own transform moves only its rendering, while the space its margin
   * reserves stays where the untransformed box left it — measured, a 100px block
   * with `margin-bottom: 20px` under `scale(2)` leaves a gap of MINUS eighty
   * pixels, drawn over the neighbour the margin is holding away.
   *
   * PER EDGE, and the question asked is the direct one: does this edge RENDER
   * where it LAYS OUT. Coarser answers were tried and each was a different wrong
   * one. Reading whether a transform is DECLARED blanks the margins of every
   * resting hover state, since `scale(1)`, `translate(0)` and `rotate(360deg)`
   * all compute to a non-`none` matrix that moves nothing. Reading it per AXIS
   * blanks a valid band whenever one edge is pinned: measured,
   * `translateY(-25px) scaleY(0.5)` on a 100px block computes to
   * `matrix(1, 0, 0, 0.5, 0, -25)` and renders its top edge exactly where the
   * layout put it while moving the bottom one, and `transform` is a catalog
   * property so an author reaches that with no `transform-origin` at all.
   *
   * There is no finer grain below an edge, which is the point of asking the
   * question this way rather than refining a proxy again.
   */
  readonly selfMoved: MovedEdges;
  /**
   * The composition ABOVE the element, excluding its own transform.
   *
   * Margins are measured with this and padding with the composed scale, because
   * the two live in different spaces. Padding is inside the element's own
   * transform and renders scaled with it; a margin is laid out in the PARENT's
   * coordinates, and the element's own transform never touches the space it
   * reserves.
   *
   * Measured: a 100px block with `margin-top: 28px` and a transform pinning its
   * top edge leaves a real gap of 28 rendered pixels above it, not 14 — so a
   * band drawn at the composed scale is half the size of the space it names.
   */
  readonly ancestor: { readonly x: number; readonly y: number };
}

/** Which physical edges are drawn away from where they were laid out. */
export interface MovedEdges {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

const NO_EDGE_MOVED: MovedEdges = {
  top: false,
  right: false,
  bottom: false,
  left: false,
};

/**
 * How far an edge may be drawn from its layout position and still count as put.
 *
 * Half a rendered pixel: below that the band and the space it names are the same
 * pixels on screen, and refusing the band would cost an author information to
 * avoid an error nobody can see. Deliberately NOT the axis-aligned tolerance,
 * which guards serialization noise in a matrix term; this one is about what is
 * visible, and the two would drift apart if they shared a constant.
 */
const EDGE_STILL_PX = 0.5;

const IDENTITY_SCALE: RenderedScale = {
  x: 1,
  y: 1,
  ancestor: { x: 1, y: 1 },
  describable: true,
  selfMoved: NO_EDGE_MOVED,
};

/** Below this, an off-diagonal matrix term is serialization noise, not a rotation. */
const AXIS_ALIGNED_TOLERANCE = 1e-9;

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
  let own: DOMMatrix | null = null;
  /*
   * The composition ABOVE the element, accumulated in the same walk.
   *
   * Margins need it and padding does not, because they live in different
   * spaces: padding is inside the element's own transform and renders scaled
   * with it, while a margin is laid out in the PARENT's coordinates and the
   * element's own transform never touches it.
   */
  let ancestors = new view.DOMMatrix();
  for (
    let node: Element | null = element;
    node !== null && node !== root;
    node = node.parentElement
  ) {
    const declared = view.getComputedStyle(node).transform;
    if (declared === "" || declared === "none") continue;
    const step = new view.DOMMatrix(declared);
    // Kept from the walk that is already happening rather than read again, so
    // the composed answer and the element's own cannot disagree about which
    // declaration was seen.
    if (node === element) own = step;
    else ancestors = step.multiply(ancestors);
    matrix = step.multiply(matrix);
  }

  /*
   * `b` and `c` are the off-diagonal terms: zero for any composition of
   * translations and axis-aligned scales, non-zero the moment a rotation or a
   * skew enters.
   *
   * Compared against a TOLERANCE rather than to zero exactly. A transform that is
   * geometrically the identity can be written as one that is not —
   * `rotate(360deg)`, `rotate(1turn)` — and an engine is free to serialize the
   * sine residue rather than normalize it away. Measured in Chromium, both of
   * those come back exactly zero, so this guards an engine that behaves
   * differently rather than a failure anyone has seen here.
   *
   * The bound rejects nothing real: the off-diagonal term of a thousandth of a
   * degree of rotation is about 1.7e-5, four orders of magnitude above it.
   *
   * `is2D` is a separate question and a 2D check does not imply it. A
   * `perspective(500px) rotateY(30deg)` projects the box as a trapezoid whose
   * scale varies across it, and the flattened matrix can still show zero
   * off-diagonal terms with positive `a` and `d` — describable by those tests
   * and describable by nothing that draws rectangles.
   */
  const axisAligned =
    matrix.is2D &&
    Math.abs(matrix.b) < AXIS_ALIGNED_TOLERANCE &&
    Math.abs(matrix.c) < AXIS_ALIGNED_TOLERANCE;
  const describable = axisAligned && matrix.a > 0 && matrix.d > 0;
  const scale = { x: matrix.a, y: matrix.d };
  const ancestor = { x: ancestors.a, y: ancestors.d };
  return {
    ...scale,
    ancestor,
    describable,
    /*
     * Only asked where the composed scale is usable, because deriving the
     * untransformed box divides by it: a collapsed or mirrored composition has
     * no box to measure against, and the caller refuses such an element
     * outright, so every edge is reported moved rather than divided for.
     */
    selfMoved: describable
      ? edgesMovedBy(
          own,
          transformOriginOf(view.getComputedStyle(element)),
          untransformedBox(element, scale),
          ancestor
        )
      : { top: true, right: true, bottom: true, left: true },
  };
}

/**
 * How far each of the box's four extremes is drawn from where it was laid out.
 *
 * A transform about an origin maps a local coordinate `v` to
 * `o + factor * (v - o) + shift`, so an extreme at `v` is displaced by
 * `(o - v) * (1 - factor) + shift`. The near extreme sits at `v = 0` and the far
 * one at `v = size`, which is the whole of the arithmetic.
 *
 * Compared in RENDERED pixels rather than local ones, because the tolerance is
 * about what an author can see: a tenth of a local pixel under a tenfold
 * ancestor scale is a visible pixel on screen, and the same displacement inside
 * a shrunken ancestor is not.
 *
 * Converted by the ANCESTOR scale, never the composed one. The displacement is
 * already expressed in the parent's coordinates — the element's own transform is
 * what produced it — so multiplying by that transform again counts it twice and
 * understates the movement by exactly the factor doing the moving. Measured, a
 * 100px block under `scaleY(0.01)` displaces each vertical extreme by 49.5
 * rendered pixels while the composed conversion answers 0.495, which is under
 * the threshold and would call a plainly moved extreme stationary.
 *
 * These are EXTREMES of the box rather than named sides, and the distinction is
 * load-bearing under a reflection: the image of `v = 0` is then the rendered
 * box's far side, so `leftX` names the displacement of the near extreme and not
 * of whatever ends up on the left. Callers that could meet a reflection refuse
 * it before reading these.
 */
function endpointsMovedBy(
  own: DOMMatrix,
  origin: { x: number; y: number },
  box: { width: number; height: number },
  ancestor: { x: number; y: number }
): { topY: boolean; bottomY: boolean; leftX: boolean; rightX: boolean } {
  const moved = (
    o: number,
    v: number,
    factor: number,
    shift: number,
    axisScale: number
  ): boolean =>
    Math.abs(((o - v) * (1 - factor) + shift) * axisScale) > EDGE_STILL_PX;

  return {
    topY: moved(origin.y, 0, own.d, own.f, ancestor.y),
    bottomY: moved(origin.y, box.height, own.d, own.f, ancestor.y),
    leftX: moved(origin.x, 0, own.a, own.e, ancestor.x),
    rightX: moved(origin.x, box.width, own.a, own.e, ancestor.x),
  };
}

/**
 * Which physical edges a single element's own transform draws away from layout.
 *
 * Asked of the MATRIX rather than of the declaration, because a declaration that
 * moves nothing is ordinary: `scale(1)`, `translate(0)`, `translateY(0)` and
 * `rotate(360deg)` all compute to a non-`none` transform and all serialize to
 * exactly `matrix(1, 0, 0, 1, 0, 0)`. They are the resting state of every hover
 * animation, so reading presence rather than effect blanks the margins of a
 * large share of real pages.
 *
 * Asked PER EDGE rather than per axis, because a transform is applied about
 * `transform-origin` and a translate composed with a scale pins one edge while
 * moving the other. Measured, `translateY(-25px) scaleY(0.5)` on a 100px block
 * renders its top edge exactly where layout put it and moves only the bottom —
 * and that needs `transform` alone, which IS a catalog property.
 *
 * An earlier version answered per axis and argued the pinned case could not
 * arise, on the grounds that `transform-origin` is not authorable here. That
 * trace was right and the conclusion drawn from it was too wide: proving one
 * MECHANISM unreachable is not proving the STATE unreachable, and composing two
 * functions of one property reaches it. The note is kept because the shape of
 * the error is worth more than the correction — the question to ask of an
 * unreachability argument is what ELSE produces the state.
 *
 * `a` and `d` are the per-axis scales and `e`/`f` the per-axis translations,
 * which is why each edge is decided by the two terms of its own axis. A rotation
 * or a skew mixes the axes and moves every edge; anything not flat in 2D is not
 * decidable by these terms at all, and all four are reported moved rather than
 * guessed at.
 *
 * There is no grain below an edge, which is the point of asking whether an edge
 * RENDERS WHERE IT LAYS OUT rather than refining a proxy for a fourth time.
 */
function edgesMovedBy(
  own: DOMMatrix | null,
  origin: { x: number; y: number },
  box: { width: number; height: number },
  ancestor: { x: number; y: number }
): MovedEdges {
  const EVERY_EDGE: MovedEdges = {
    top: true,
    right: true,
    bottom: true,
    left: true,
  };
  if (own === null) return { ...NO_EDGE_MOVED };
  /*
   * A non-positive ancestor scale carries no margin that can be drawn, and it
   * reaches here past the caller's own guard: that guard reads the COMPOSED
   * matrix, and an ancestor reflection CANCELLED by the element's own reflection
   * composes to a positive matrix. Measured, a parent at `scaleX(-1)` holding a
   * child at `translateX(-200px) scaleX(-1)` composes to `a = 1` and passes
   * describability while the ancestor's own `a` is still −1.
   *
   * Left unchecked that negative factor becomes the margin's scale, turning a
   * positive margin into a negative extent — which the band code draws INWARD
   * over the content while still labelling it as ordinary positive spacing. The
   * mirrored space is real; a rectangle claiming to be it is not.
   */
  if (!(ancestor.x > 0) || !(ancestor.y > 0)) return EVERY_EDGE;
  const skewed =
    !own.is2D ||
    Math.abs(own.b) > AXIS_ALIGNED_TOLERANCE ||
    Math.abs(own.c) > AXIS_ALIGNED_TOLERANCE;
  if (skewed) return EVERY_EDGE;

  /*
   * How far one edge is drawn from where it was laid out.
   *
   * A transform about an origin maps a local coordinate `v` to
   * `o + factor * (v - o) + shift`, so an edge at `v` is displaced by
   * `(o - v) * (1 - factor) + shift`. The near edge sits at `v = 0` and the far
   * one at `v = size`, which is the whole of the arithmetic.
   *
   * Compared in RENDERED pixels rather than local ones, because the tolerance is
   * about what an author can see: a tenth of a local pixel under a tenfold
   * ancestor scale is a visible pixel on screen, and the same displacement
   * inside a shrunken ancestor is not.
   *
   * Converted by the ANCESTOR scale, never the composed one. The displacement
   * above is already expressed in the parent's coordinates — the element's own
   * transform is what produced it — so multiplying by that transform again
   * counts it twice and understates the movement by exactly the factor doing
   * the moving. Measured, a 100px block under `scaleY(0.01)` displaces each
   * vertical edge by 49.5 rendered pixels while the composed conversion answers
   * 0.495, which is under the threshold and would call a plainly moved edge
   * stationary.
   */
  const { topY, bottomY, leftX, rightX } = endpointsMovedBy(
    own,
    origin,
    box,
    ancestor
  );

  return edgesFromEndpoints({ topY, bottomY, leftX, rightX });
}

/**
 * Which edges are undrawable, given which of the box's extremes moved.
 *
 * An edge is a SEGMENT, so BOTH of its endpoints have to land where layout put
 * them. Its own coordinate is only half the question: measured,
 * `translate(30px, -25px) scaleY(0.5)` leaves the top edge's Y exactly where
 * layout had it and slides the whole edge thirty pixels sideways, so a band
 * anchored to it names pixels the margin never occupied, at exactly the right
 * height.
 *
 * The top and bottom edges therefore need the horizontal extent still, and the
 * left and right edges need the vertical extent still — which is why the four
 * answers are not independent even though the four displacements are.
 */
function edgesFromEndpoints(moved: {
  topY: boolean;
  bottomY: boolean;
  leftX: boolean;
  rightX: boolean;
}): MovedEdges {
  const acrossStill = !moved.leftX && !moved.rightX;
  const downStill = !moved.topY && !moved.bottomY;
  return {
    top: moved.topY || !acrossStill,
    bottom: moved.bottomY || !acrossStill,
    left: moved.leftX || !downStill,
    right: moved.rightX || !downStill,
  };
}

/**
 * The element's own border box before its own transform, in local pixels.
 *
 * Derived from the rendered rectangle and the COMPOSED scale rather than read
 * from `offsetWidth`, which is integer-rounded: half a pixel of rounding is
 * multiplied by `1 - factor` in the arithmetic above, and under a large scale
 * that is enough to report a stationary edge as displaced.
 *
 * The composed scale is used because the rendered rectangle has been through
 * every transform between the element and the root, not only its own.
 */
function untransformedBox(
  element: Element,
  scale: { x: number; y: number }
): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return { width: rect.width / scale.x, height: rect.height / scale.y };
}

/** The resolved `transform-origin`, in local pixels from the border box's corner. */
function transformOriginOf(style: CSSStyleDeclaration): {
  x: number;
  y: number;
} {
  // Two or three components, space separated, already resolved to pixels by the
  // time computed style reports them — a keyword or a percentage never survives
  // to here. The third is the Z origin, which an axis-aligned box ignores.
  const parts = style.transformOrigin.split(" ");
  return { x: edgeWidth(parts[0] ?? ""), y: edgeWidth(parts[1] ?? "") };
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
 * excludes neither, so their difference beyond the borders IS the gutter.
 *
 * THE THRESHOLD IS A ROUNDING BOUND, not a guess. Both readings are integer
 * rounded INDEPENDENTLY while the border subtracted from them is exact and may
 * be fractional, so the residue on a container with no scrollbar at all can
 * reach a whole pixel — half from each — and a fractional border on a high-DPI
 * display is enough to produce it. Two pixels clears that bound with room, and
 * clears nothing real: the narrowest scrollbar a platform draws is `thin`, which
 * is eight pixels at its slimmest, and a classic one is around fifteen.
 *
 * Reported rather than corrected. The caller declines a block whose padding
 * geometry cannot be represented, which is one rule it already applies to
 * several other shapes.
 */
/**
 * The most two independently rounded readings can differ by, plus a margin.
 *
 * Half a pixel each, so a whole pixel of residue is reachable with no scrollbar
 * present; two leaves room without reaching any real scrollbar width.
 */
const ROUNDING_BOUND_PX = 2;

export function hasScrollbarGutter(
  element: Element,
  borders: { x: number; y: number }
): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null) return false;
  /*
   * The ELEMENT's realm, not the one asking — see `canvasRootFrom` for why the
   * ambient `HTMLElement` is the wrong constructor to compare against.
   *
   * Getting it wrong here fails SILENTLY and in the unsafe direction. A canvas
   * mounted into a same-origin iframe answers `false` before measuring
   * anything, so the refusal below never fires and every scrolling block in
   * that canvas draws its padding bands across the reserved scrollbar.
   */
  if (!(element instanceof view.HTMLElement)) return false;

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
  return gutterX > ROUNDING_BOUND_PX || gutterY > ROUNDING_BOUND_PX;
}

/**
 * Whether an ancestor between this element and the canvas root clips it.
 *
 * `overflow` is a catalog keyword taking `hidden`, `clip`, `scroll` or `auto` —
 * and taking TWO of them, so the axes can clip differently — so an author can
 * put a block inside a container that cuts part of it off. The
 * element's own bounding rectangle is reported UNCLIPPED, and the overlay draws
 * as a sibling of the page rather than inside that container — so bands derived
 * from the full rectangle escape the ancestor's clip and paint over ground where
 * the block is not rendered.
 *
 * Only a clip that ACTUALLY cuts is reported. A block sitting wholly inside an
 * `overflow: hidden` card is not clipped by it, and that is the ordinary case —
 * refusing on the presence of a clipping ancestor rather than on the fact of
 * being clipped would blank the overlay for most well-built pages.
 *
 * The walk stops BELOW the root. The shell scrolls the canvas from above, and
 * that clipping applies to the bands and the page alike, so it produces no
 * mismatch; only a clip between the block and the root does.
 */
/**
 * Computed `display` values whose generated box `overflow` does not clip.
 *
 * MEASURED across the catalog's display set in Chromium rather than read off a
 * spec table, by giving each value `overflow: hidden` and a child pulled outside
 * it, then reading the pixels. The list is wider than the inline box people
 * reach for first, and two of the entries are not guessable:
 *
 * - The internal TABLE boxes take no clip — a row, a row group, a header group
 *   and a footer group all paint a child straight through the edge — while
 *   `table`, `inline-table` and `table-cell` all clip normally.
 * - `contents` generates no box at all, so nothing clips AND
 *   `getBoundingClientRect` answers 0x0 on it. A caller that skipped this entry
 *   would compare a descendant against a zero-sized rectangle and conclude every
 *   block is outside it.
 *
 * `ruby-base`, `ruby-base-container` and `ruby-text-container` are deliberately
 * ABSENT: all three compute to plain `block` in Chromium, so they clip and an
 * entry for them would describe a value that never arrives.
 *
 * The measurement had to force overflow with a NEGATIVE MARGIN rather than an
 * oversized child, because table boxes size to their content: a wide child makes
 * them grow to fit, and "not clipped" then means "never overflowed" — which read
 * as six false entries on the first pass.
 */
const OVERFLOW_NEVER_CLIPS: ReadonlySet<string> = new Set([
  "inline",
  "inline list-item",
  "table-row",
  "table-row-group",
  "table-header-group",
  "table-footer-group",
  "ruby",
  "ruby-text",
  "contents",
]);

/** Whether `overflow` establishes a clip on a box with this computed display. */
export function overflowApplies(display: string): boolean {
  return !OVERFLOW_NEVER_CLIPS.has(display);
}

/** A computed border width in pixels, or zero when the browser reports no number. */
function edgeWidth(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clippedByAncestor(
  element: Element,
  root: Element,
  radii: CornerRadii
): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null) return false;
  const box = element.getBoundingClientRect();

  for (
    let node: Element | null = element.parentElement;
    node !== null && node !== root;
    node = node.parentElement
  ) {
    if (cutByAncestor(node, box, radii, view, root)) return true;
  }
  return false;
}

/**
 * Whether ONE ancestor cuts the block.
 *
 * Separated from the walk above so that each answers a single question: which
 * elements to ask, and what the answer is for one of them. The decision needs
 * four readings of that element and three independent reasons to refuse, and
 * inlining it into the loop puts all of that inside a `for` whose own job is
 * one line long.
 */
function cutByAncestor(
  node: Element,
  box: DOMRect,
  radii: CornerRadii,
  view: Window,
  root: Element
): boolean {
  const style = view.getComputedStyle(node);
  /*
   * PER AXIS, because the two can differ and the catalog ships the shorthand
   * that makes them differ: `overflow` takes two values, so `clip visible` is
   * a declaration an author can store. Measured in Chromium it is also the
   * ONLY mixed pair that survives computation — pairing `visible` with
   * `hidden`, `auto` or `scroll` resolves the `visible` side to `auto`, while
   * `clip visible` stays exactly as written.
   *
   * Asking whether EITHER axis clips and then comparing all four edges
   * refuses a block that overflows only the axis still rendering it, and a
   * refusal costs every band on the block.
   */
  const clipsX = style.overflowX !== "visible";
  const clipsY = style.overflowY !== "visible";
  if (!clipsX && !clipsY) return false;
  /*
   * A computed `overflow` is not the same as an overflow that CLIPS. The
   * property does not apply to every generated box, and the computed value says
   * nothing about that — so an author who writes `overflow: hidden` on an inline
   * span gets the declaration in the computed style and no clip on the page.
   * Reading the first as the second cuts a descendant nothing removes.
   */
  if (!overflowApplies(style.display)) return false;
  /*
   * Overflow clips at the PADDING edge, and `getBoundingClientRect` reports the
   * BORDER box. On a container with a border the two differ by its width, so a
   * child pulled into the border by a negative margin or a transform is
   * visibly cut while a border-box comparison reports it contained — measured,
   * a 20px border puts the border box at 217 and the clip edge at 237.
   */
  const outer = node.getBoundingClientRect();
  /*
   * Scaled, because the two readings are in different units: `outer` is
   * post-transform and a computed border width is unscaled CSS pixels. Under
   * `scale(2)` a 20px border renders 40px thick, so insetting by 20 puts the
   * clip edge half way through the border and accepts a child the container
   * visibly cuts — measured, the real padding edge sat at 40 while this
   * arithmetic answered 20 and a child at exactly 20 was let through.
   */
  const scale = renderedScale(node, root);
  /*
   * A clipping ancestor that is not axis-aligned is DECLINED rather than
   * measured, because neither reading survives its transform: `a` and `d` are
   * not scale factors once a rotation is present, and `getBoundingClientRect`
   * answers with an axis-aligned BOUNDING box whose edges are not the clip
   * edges at all. The real clip is a slanted rectangle sitting inside that
   * box, so a child cut by it still reads as contained.
   *
   * It cannot be left to the caller's own describability check, which is what
   * an earlier version of this assumed: a descendant carrying the INVERSE
   * transform composes back to an axis-aligned matrix, so the block passes
   * that check while this ancestor fails it. Measured — a block under
   * `rotate(-30deg)` inside an ancestor under `rotate(30deg)` composes to
   * `a=0.999999, b=0, c=0, d=0.999999` and is called describable, while its
   * ancestor's own matrix carries `b=0.5, c=-0.5`; the block sat inside the
   * ancestor's bounding box with a quarter of it beyond the clip.
   *
   * Refusing is deliberately broader than the defect: a block WHOLLY INSIDE a
   * rotated clipping ancestor is not cut and loses its bands anyway. Deciding
   * that needs the clip as an oriented rectangle, and drawing nothing is the
   * same answer this module already gives for every other shape it cannot
   * describe.
   */
  if (!scale.describable) return true;
  const clip = clipEdges(outer, style, scale);
  if (cutByEdges(box, clip, clipsX, clipsY)) return true;
  return cutByCorner(
    box,
    radii,
    clip,
    style,
    scale,
    clipsX && clipsY,
    CLIP_SLACK_PX
  );
}

/**
 * How far a block may sit outside a clip edge before the overhang is real.
 *
 * Half a pixel, because both rectangles are fractional and a block laid out
 * flush against its container's edge is not clipped by rounding.
 */
const CLIP_SLACK_PX = 0.5;

/** The ancestor's PADDING edge, which is where overflow actually clips. */
function clipEdges(
  outer: DOMRect,
  style: CSSStyleDeclaration,
  scale: RenderedScale
): EdgeBounds {
  return {
    top: outer.top + edgeWidth(style.borderTopWidth) * scale.y,
    left: outer.left + edgeWidth(style.borderLeftWidth) * scale.x,
    bottom: outer.bottom - edgeWidth(style.borderBottomWidth) * scale.y,
    right: outer.right - edgeWidth(style.borderRightWidth) * scale.x,
  };
}

/**
 * Whether the block falls outside the clip RECTANGLE, on an axis that clips.
 *
 * Each axis is asked only where it clips: a block overflowing the axis that is
 * still `visible` has its overflow rendered, and refusing it costs every band.
 */
function cutByEdges(
  box: DOMRect,
  clip: EdgeBounds,
  clipsX: boolean,
  clipsY: boolean
): boolean {
  const cutVertically =
    clipsY &&
    (box.top < clip.top - CLIP_SLACK_PX ||
      box.bottom > clip.bottom + CLIP_SLACK_PX);
  const cutHorizontally =
    clipsX &&
    (box.left < clip.left - CLIP_SLACK_PX ||
      box.right > clip.right + CLIP_SLACK_PX);
  return cutVertically || cutHorizontally;
}

/**
 * Whether a rounded clipping ancestor cuts the block at one of its CORNERS.
 *
 * A container with `border-radius` and `overflow: hidden` clips on the curve,
 * not on the rectangle: a child inside all four padding edges can still have a
 * corner visibly removed, and the comparison above accepts it. That container is
 * the ordinary card, so declining every rounded ancestor outright would blank
 * the overlay for most blocks on a real page — the exact test is what keeps the
 * refusal to the blocks that are genuinely cut.
 *
 * Asked only when BOTH axes clip, which is measured rather than assumed. With
 * `overflow: clip visible` the clip region is unbounded on the visible axis, and
 * a corner needs two bounds to exist — probed in Chromium, a child at the corner
 * of a 60px-radius box under `overflow: clip visible` is painted in full, while
 * the same child under `overflow: hidden` is cut away. Applying the arc there
 * would refuse a block nothing removes.
 *
 * The radii come off the PADDING box, because that is where overflow clips and
 * `border-radius` states the border box's curve.
 */
function cutByCorner(
  box: DOMRect,
  radii: CornerRadii,
  clip: EdgeBounds,
  style: CSSStyleDeclaration,
  scale: RenderedScale,
  bothAxesClip: boolean,
  slack: number
): boolean {
  if (!bothAxesClip) return false;
  const outer = usedCornerRadii(
    {
      topLeft: style.borderTopLeftRadius,
      topRight: style.borderTopRightRadius,
      bottomRight: style.borderBottomRightRadius,
      bottomLeft: style.borderBottomLeftRadius,
    },
    /*
     * The ancestor's LAYOUT size, so a percentage resolves against what the
     * author declared it against. `clip` is post-transform and inset to the
     * padding edge, so it is divided back out by the scale and re-widened by the
     * borders that were taken off it.
     */
    {
      width: (clip.right - clip.left) / scale.x + borderSpan(style, "x"),
      height: (clip.bottom - clip.top) / scale.y + borderSpan(style, "y"),
    }
  );
  /*
   * A radius this cannot resolve is a clip of UNKNOWN shape, and the block is
   * refused rather than treated as sitting inside a square one — the same answer
   * this module gives for every other geometry it cannot describe.
   */
  if (outer === undefined) return true;
  const inner = scaleCornerRadii(
    insetCornerRadii(outer, {
      top: edgeWidth(style.borderTopWidth),
      right: edgeWidth(style.borderRightWidth),
      bottom: edgeWidth(style.borderBottomWidth),
      left: edgeWidth(style.borderLeftWidth),
    }),
    scale
  );
  if (isSquare(inner)) return false;
  /*
   * The block's OWN curve is part of the comparison. A rounded block flush
   * inside an equally rounded container is not cut at all, while its bounding
   * rectangle's corners lie outside every one of that container's arcs — so
   * reading only the rectangle refuses the ordinary nested rounded card and
   * takes the whole overlay with it.
   */
  return !roundedInsideRounded(box, radii, clip, inner, slack);
}

/** The two border widths an axis loses, in unscaled CSS pixels. */
function borderSpan(style: CSSStyleDeclaration, axis: "x" | "y"): number {
  return axis === "x"
    ? edgeWidth(style.borderLeftWidth) + edgeWidth(style.borderRightWidth)
    : edgeWidth(style.borderTopWidth) + edgeWidth(style.borderBottomWidth);
}

/**
 * The canvas root an element sits inside, as an `HTMLElement` of its OWN realm.
 *
 * `instanceof HTMLElement` compares against the constructor of the realm doing
 * the asking. A host that mounts the canvas into a same-origin iframe through a
 * portal gets a root built by that iframe's realm, and the check fails for a
 * perfectly good element — so chrome would return early and draw nothing,
 * silently, on exactly the iframe canvas `geometry.ts` documents.
 *
 * Here rather than at each caller because two of them ask the same question, and
 * the realm-safe spelling is the kind of detail that gets written correctly once
 * and copied wrongly afterwards.
 */
export function canvasRootFrom(
  element: Element,
  rootClass: string
): HTMLElement | null {
  const root = element.closest(`.${rootClass}`);
  if (root === null) return null;
  const realm = root.ownerDocument.defaultView;
  if (realm === null) return null;
  return root instanceof realm.HTMLElement ? root : null;
}
