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
  /**
   * The axes the element's OWN transform moves or rescales, if any.
   *
   * Separated from the composed scale because the two do OPPOSITE things to a
   * margin. **A transform does not affect layout.** An ancestor's transform
   * scales the whole subtree it lays out, gaps included, so a margin inside one
   * really does render smaller and `x`/`y` above are right to apply. The
   * element's own transform moves only its rendering, while the space its
   * margin reserves stays where the untransformed box left it.
   *
   * Measured on a 100px block with a 20px margin, reading the gap between the
   * rendered border edge and the next sibling on each axis:
   *
   * | transform on the block | vertical gap | horizontal gap |
   * | --- | --- | --- |
   * | none | 20 | 20 |
   * | `scale(1)`, `translate(0)`, `rotate(360deg)` | 20 | 20 |
   * | `translateY(40px)` | **−20** | 20 |
   * | `translateX(30px)` | 20 | **−10** |
   * | `scaleY(0.5)` | **70** | 20 |
   * | `scaleX(0.5)` | 20 | **70** |
   *
   * Two things follow, and each rules out a simpler answer.
   *
   * PER AXIS, because a transform on one axis leaves the other's margin exactly
   * where it was — and a lift like `translateY(-4px)` is a common hover state
   * whose left and right bands stay perfectly good.
   *
   * By the MATRIX, not by the presence of a declaration. `scale(1)`,
   * `translate(0)`, `translateY(0)` and `rotate(360deg)` all compute to a
   * non-`none` transform and all serialize to exactly
   * `matrix(1, 0, 0, 1, 0, 0)`; they move nothing, and they are the resting
   * state of every hover animation, so treating them as displacement would
   * blank the margins of a large share of real pages.
   *
   * The negatives in that table are why an axis this reports is DECLINED rather
   * than corrected: the block is drawn over the neighbour its margin is holding
   * away, so no rectangle beside the rendered border edge describes it and no
   * factor applied to `20` produces one.
   */
  readonly selfMoved: { readonly x: boolean; readonly y: boolean };
}

const NOT_MOVED = { x: false, y: false } as const;

const IDENTITY_SCALE: RenderedScale = {
  x: 1,
  y: 1,
  describable: true,
  selfMoved: NOT_MOVED,
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
  return {
    x: matrix.a,
    y: matrix.d,
    describable: axisAligned && matrix.a > 0 && matrix.d > 0,
    selfMoved: axesMovedBy(own),
  };
}

/**
 * Which axes a single element's own transform actually displaces.
 *
 * Asked of the MATRIX rather than of the declaration, because a declaration
 * that moves nothing is ordinary: `scale(1)`, `translate(0)`, `translateY(0)`
 * and `rotate(360deg)` all compute to a non-`none` transform and all serialize
 * to exactly `matrix(1, 0, 0, 1, 0, 0)`. They are the resting state of every
 * hover animation, so reading presence rather than effect blanks the margins of
 * a large share of real pages.
 *
 * `a` and `d` are the per-axis scales and `e`/`f` the per-axis translations, so
 * each axis is decided by its own two terms. A rotation or a skew mixes the
 * axes and moves both; anything not flat in 2D is not decidable by these terms
 * at all, and both are reported moved rather than guessed at.
 *
 * The tolerance is the same one the axis-aligned test uses and is there for the
 * same reason: an engine may serialize a geometric identity with a residue
 * instead of normalizing it away. It is far below any displacement a person
 * could author or see.
 *
 * PER AXIS RATHER THAN PER EDGE, which is a deliberate bound and not an
 * oversight. A transform is applied about `transform-origin`, so an origin
 * anchored to one side leaves that side's edge stationary and moves only the
 * far one — under `transform-origin: top` and `scaleY(0.5)`, measured, the top
 * edge does not move at all and its margin stays perfectly describable.
 *
 * That state is not reachable here. `transform` is a catalog property and
 * `transform-origin` is NOT, so every transform this system can author is
 * applied about the initial `50% 50%` — and measured under that origin,
 * `scaleY(0.5)` moves the top edge as well as the bottom, which is exactly what
 * an axis answers. Per edge would additionally have to read and resolve the
 * origin and the untransformed box on every measure, paying for a case the
 * catalog cannot produce.
 *
 * Should `transform-origin` ever join the catalog, this becomes conservative
 * rather than wrong: an anchored edge keeps its band today and would lose it,
 * which is the safe direction to be imprecise in.
 */
function axesMovedBy(own: DOMMatrix | null): { x: boolean; y: boolean } {
  if (own === null) return { ...NOT_MOVED };
  const off = (value: number): boolean =>
    Math.abs(value) > AXIS_ALIGNED_TOLERANCE;
  if (!own.is2D || off(own.b) || off(own.c)) return { x: true, y: true };
  return {
    x: off(own.a - 1) || off(own.e),
    y: off(own.d - 1) || off(own.f),
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
/** A computed border width in pixels, or zero when the browser reports no number. */
function edgeWidth(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clippedByAncestor(element: Element, root: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null) return false;
  const box = element.getBoundingClientRect();

  for (
    let node: Element | null = element.parentElement;
    node !== null && node !== root;
    node = node.parentElement
  ) {
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
    if (!clipsX && !clipsY) continue;
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
    const clip = {
      top: outer.top + edgeWidth(style.borderTopWidth) * scale.y,
      left: outer.left + edgeWidth(style.borderLeftWidth) * scale.x,
      bottom: outer.bottom - edgeWidth(style.borderBottomWidth) * scale.y,
      right: outer.right - edgeWidth(style.borderRightWidth) * scale.x,
    };
    // Half a pixel, because both rectangles are fractional and a block laid out
    // flush against its container's edge is not clipped by rounding.
    const slack = 0.5;
    const cutVertically =
      clipsY &&
      (box.top < clip.top - slack || box.bottom > clip.bottom + slack);
    const cutHorizontally =
      clipsX &&
      (box.left < clip.left - slack || box.right > clip.right + slack);
    if (cutVertically || cutHorizontally) {
      return true;
    }
  }
  return false;
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
