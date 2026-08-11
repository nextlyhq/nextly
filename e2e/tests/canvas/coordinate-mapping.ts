/**
 * The canvas↔host mapping the acceptance tests measure against.
 *
 * **Adapts the editor's own mapping rather than restating it.** The arithmetic
 * lives once, in `@nextlyhq/builder`, and this file only changes the call shape:
 * these helpers take `(value, frameOrigin, scale)` because that is how a
 * Playwright test has the numbers to hand — origin from the frame element's
 * box, scale read off the page — while the editor holds them together as one
 * `FrameGeometry`.
 *
 * The reason it is an adapter and not a copy is what the tests are FOR. A
 * browser harness carrying its own arithmetic certifies its own arithmetic: the
 * two agree on the day they are written, and the first correction to either
 * makes the acceptance suite validate a stale copy while reporting that the
 * editor is fine. That failure is invisible, because both sides are
 * individually self-consistent.
 *
 * A consequence worth knowing before it surprises someone: a frame that cannot
 * describe a mapping — a zero, negative or non-finite scale — now THROWS rather
 * than returning `NaN` coordinates, because that is what the editor's mapping
 * does. A test measuring an unrendered element gets an error naming the problem
 * instead of an assertion failure about numbers that were never meaningful.
 */
import {
  pointToCanvas,
  pointToHost,
  rectToHost,
  type FrameGeometry,
} from "@nextlyhq/builder";

import type { Point, Rect } from "./driver";

/** The two numbers a Playwright test has, in the shape the editor's mapping takes. */
function frame(frameOrigin: Point, scale: number): FrameGeometry {
  return { origin: frameOrigin, scale };
}

/**
 * Convert a point inside the canvas frame to the host document's coordinates.
 *
 * The scale term is not optional: a canvas offering zoom-to-fit is exactly the
 * case dnd-kit #1706 covered, and omitting it puts the overlay progressively
 * further out the further a point sits from the frame's transform origin.
 */
export function mapFramePointToHost(
  framePoint: Point,
  frameOrigin: Point,
  scale = 1
): Point {
  return pointToHost(framePoint, frame(frameOrigin, scale));
}

/** Convert a host-document point back into the canvas frame's coordinates. */
export function mapHostPointToFrame(
  hostPoint: Point,
  frameOrigin: Point,
  scale = 1
): Point {
  return pointToCanvas(hostPoint, frame(frameOrigin, scale));
}

/** Convert a rectangle inside the frame to the host document's coordinates. */
export function mapFrameRectToHost(
  frameRect: Rect,
  frameOrigin: Point,
  scale = 1
): Rect {
  return rectToHost(frameRect, frame(frameOrigin, scale));
}
