/**
 * What an element's own transform does to its edges, worked out from numbers
 * `geometry-dom.ts` has already read.
 *
 * `renderedScale` there walks the transforms between an element and the canvas
 * root and measures the element. The arithmetic it then does on the matrices it
 * composed (which of the four edges render away from where they were laid out)
 * lives here, with the types it answers in. Nothing here reads a rectangle, so
 * a measurement still enters this package through `geometry-dom.ts` alone,
 * which `geometry-ownership.test.ts` holds.
 *
 * @module geometry-transform
 */

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

export const NO_EDGE_MOVED: MovedEdges = {
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

/** Below this, an off-diagonal matrix term is serialization noise, not a rotation. */
export const AXIS_ALIGNED_TOLERANCE = 1e-9;

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
export function edgesMovedBy(
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

/** The resolved `transform-origin`, in local pixels from the border box's corner. */
export function transformOriginOf(style: CSSStyleDeclaration): {
  x: number;
  y: number;
} {
  // Two or three components, space separated, already resolved to pixels by the
  // time computed style reports them — a keyword or a percentage never survives
  // to here. The third is the Z origin, which an axis-aligned box ignores.
  const parts = style.transformOrigin.split(" ");
  return { x: edgeWidth(parts[0] ?? ""), y: edgeWidth(parts[1] ?? "") };
}

/** A computed border width in pixels, or zero when the browser reports no number. */
export function edgeWidth(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
