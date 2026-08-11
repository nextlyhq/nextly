/**
 * The one place geometry crosses between the canvas frame and the host page.
 *
 * The canvas renders inside an iframe and the editor's chrome — the insertion
 * indicator, selection outlines, drag affordances — is drawn in the host
 * document above it. Every one of those has to answer the same question: where
 * is this canvas rectangle, in host coordinates?
 *
 * **Asked here and nowhere else.** Two modules computing that separately agree
 * on the day they are written and drift the first time anything changes — a
 * scroll offset one of them forgot, a zoom the other did not apply — and the
 * symptom is an indicator drawn a few pixels off the gap it names. That class of
 * bug is not caught by either module's own tests, because each is correct about
 * the question it asked.
 *
 * How much of that is ENFORCED, stated plainly because the difference matters:
 * a sibling test refuses a rectangle READ across the frame anywhere else in this
 * package, and the e2e helper adapts these functions rather than restating them.
 * Neither can stop a module that is handed an origin and a scale from
 * open-coding the arithmetic — two numbers multiplied and added look like any
 * other code — so that half is held at review, the same way the builder's
 * "draws with `blocks-react`" rule is.
 *
 * The functions are pure and take plain numbers rather than DOM nodes, so the
 * mapping can be exercised without a browser and the DOM reads stay at the edge.
 *
 * @module geometry
 */

/** A point in whichever coordinate space the caller is working in. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A rectangle, in the shape `getBoundingClientRect` reports. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How the canvas frame sits inside the host page.
 *
 * `origin` is where the frame's CONTENT viewport lands in host coordinates, and
 * the word content is load-bearing. `getBoundingClientRect` on an iframe reports
 * its BORDER box, while every rectangle read inside the frame is relative to the
 * content viewport — so on a frame with any border the two differ by
 * `clientLeft`/`clientTop`, and an overlay built from the border box sits a
 * couple of scaled pixels out at every point. A canvas that never sets
 * `border: none` gets the browser default and the fault is present from the
 * first render, which is exactly the sort of near-miss that reads as "the
 * indicator feels slightly off" rather than as a bug.
 *
 * Build one with {@link frameContentOrigin} rather than adding that correction
 * at the call site. An earlier version of this note pushed the arithmetic out to
 * "whoever reads the DOM", on the grounds that only the caller holds
 * `clientLeft`. That reasoning conflated the DOM READ with the arithmetic that
 * follows it: reading `clientLeft` needs a browser, turning it into an origin is
 * three multiplications over plain numbers. Two callers duly wrote the
 * correction themselves, and both wrote it the same way round and both wrong.
 *
 * `scale` is the visual scale the host applies to the frame: a zoomed-out canvas
 * at 50% has `scale: 0.5`.
 *
 * Scroll INSIDE the frame is deliberately not a field. A rectangle read from
 * inside the frame is already relative to the frame's viewport, so subtracting
 * its scroll would count it twice — the mistake that makes an overlay drift as
 * the canvas scrolls, rather than being wrong by a constant.
 */
export interface FrameGeometry {
  readonly origin: Point;
  readonly scale: number;
}

/**
 * A frame geometry that cannot describe a mapping.
 *
 * Thrown rather than defaulted, because every value that could stand in is
 * wrong in a way that looks right: a scale of zero maps the whole canvas onto a
 * point, a negative one mirrors it, and a non-finite one yields `NaN`
 * coordinates that place an overlay nowhere and report no error. An overlay
 * silently drawn at the wrong place is the exact failure this module exists to
 * prevent, so an unusable frame has to be loud.
 */
export class FrameGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameGeometryError";
  }
}

function assertUsable(frame: FrameGeometry): void {
  if (!Number.isFinite(frame.scale) || frame.scale <= 0) {
    throw new FrameGeometryError(
      `A frame scale of ${String(frame.scale)} describes no mapping. ` +
        `Scale must be finite and greater than zero.`
    );
  }
  if (!Number.isFinite(frame.origin.x) || !Number.isFinite(frame.origin.y)) {
    throw new FrameGeometryError(
      `A frame origin of (${String(frame.origin.x)}, ${String(frame.origin.y)}) ` +
        `describes no mapping. Both coordinates must be finite.`
    );
  }
}

/**
 * How far the frame's content viewport sits inside its border box.
 *
 * `clientLeft` and `clientTop` exactly as the DOM reports them, which is the
 * whole reason this type exists rather than the caller passing two numbers: they
 * are CSS pixels in the FRAME's own untransformed space. Every other coordinate
 * in this module is host space. Mixing the two is the mistake below.
 */
export interface FrameInset {
  readonly left: number;
  readonly top: number;
}

/**
 * Where the frame's content viewport starts, in host coordinates.
 *
 * `borderBox` is the corner `getBoundingClientRect` reports for the frame
 * element, and `inset` is its border width. The border is laid out in the
 * frame's own pixels, so a host that has scaled the frame scales the border with
 * everything else: at 50% a 2px border occupies 1 host pixel. Adding the inset
 * unscaled therefore misplaces the origin by `(1 - scale) * inset`, which is
 * zero at 100% and grows as the canvas zooms out — a fault that is invisible in
 * exactly the configuration people develop in.
 *
 * Both facts are needed together and neither is guessable from the other, which
 * is why this is a function rather than a note telling callers to add them up.
 */
export function frameContentOrigin(
  borderBox: Point,
  inset: FrameInset,
  scale: number
): Point {
  assertUsable({ origin: borderBox, scale });
  if (!Number.isFinite(inset.left) || !Number.isFinite(inset.top)) {
    throw new FrameGeometryError(
      `A frame inset of (${String(inset.left)}, ${String(inset.top)}) ` +
        `describes no mapping. Both edges must be finite.`
    );
  }
  return {
    x: borderBox.x + inset.left * scale,
    y: borderBox.y + inset.top * scale,
  };
}

/** A point inside the canvas frame, in host coordinates. */
export function pointToHost(point: Point, frame: FrameGeometry): Point {
  assertUsable(frame);
  return {
    x: frame.origin.x + point.x * frame.scale,
    y: frame.origin.y + point.y * frame.scale,
  };
}

/**
 * A point on the host page, in the canvas frame's coordinates.
 *
 * The exact inverse of {@link pointToHost}: a pointer event arrives in host
 * coordinates and has to be compared against rectangles read inside the frame,
 * which is the same mapping run backwards rather than a second one written to
 * match.
 */
export function pointToCanvas(point: Point, frame: FrameGeometry): Point {
  assertUsable(frame);
  return {
    x: (point.x - frame.origin.x) / frame.scale,
    y: (point.y - frame.origin.y) / frame.scale,
  };
}

/**
 * A rectangle inside the canvas frame, in host coordinates.
 *
 * Its size scales with the frame. An overlay sized from the unscaled rectangle
 * would be correct only at 100%, and would look correct there — which is how a
 * zoom bug survives review.
 */
export function rectToHost(rect: Rect, frame: FrameGeometry): Rect {
  const origin = pointToHost({ x: rect.x, y: rect.y }, frame);
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * frame.scale,
    height: rect.height * frame.scale,
  };
}
