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
 * the question it asked. A sibling test asserts that no other module in this
 * package reads a rectangle across the frame.
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
 * `origin` is where the frame's own viewport origin lands in host coordinates —
 * the frame element's position, already including any host scrolling, because
 * that is what `getBoundingClientRect` reports. `scale` is the visual scale the
 * host applies to the frame: a zoomed-out canvas at 50% has `scale: 0.5`.
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
