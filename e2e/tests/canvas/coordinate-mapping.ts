import type { Point, Rect } from "./driver";

/**
 * The single host-point-to-canvas-point mapping the master plan requires
 * (§2.8 point 5). Kept as a pure function so it can be tested against ground
 * truth rather than inferred from whether an overlay looks right.
 *
 * A frame-local point is scaled by whatever transform the frame carries and
 * then offset by the frame's own position in the host. The scale term is not
 * optional: a canvas offering zoom-to-fit is exactly the case dnd-kit #1706
 * covered, and omitting it puts the overlay progressively further out the
 * further a point sits from the frame's transform origin.
 */
export function mapFramePointToHost(
  framePoint: Point,
  frameOrigin: Point,
  scale = 1
): Point {
  return {
    x: frameOrigin.x + framePoint.x * scale,
    y: frameOrigin.y + framePoint.y * scale,
  };
}

/** The same mapping for a rect, so an indicator can be drawn in parent chrome. */
export function mapFrameRectToHost(
  frameRect: Rect,
  frameOrigin: Point,
  scale = 1
): Rect {
  const topLeft = mapFramePointToHost(frameRect, frameOrigin, scale);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: frameRect.width * scale,
    height: frameRect.height * scale,
  };
}
