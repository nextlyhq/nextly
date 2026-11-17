/**
 * How fast the canvas scrolls while a drag rests near its edge.
 *
 * A page is taller than the canvas shows, and a drag can only drop where it can
 * point. Without this, a block cannot be moved to anywhere outside the visible
 * band at all — not slowly, not awkwardly, not at all — because the position it
 * would be dropped at never comes on screen. Every drag surface solves it the
 * same way, and the part worth getting right is the SPEED CURVE rather than the
 * plumbing.
 *
 * **Proportional, not constant.** A fixed speed forces a choice between one that
 * is too slow to cross a long page and one that overshoots a target near the
 * edge. Ramping from nothing at the band's inner boundary to full speed at the
 * rim gives both: the author controls the rate by how far in they push, so a
 * long haul and a one-line nudge are the same gesture at different depths.
 *
 * **Pure, and in client coordinates.** No DOM, no timers, no element. The caller
 * owns the frame loop and the scrolling; this decides only how far this frame
 * should move. That split is what lets the curve be asserted at sizes and
 * positions a jsdom test cannot produce, since every rectangle there is zero.
 *
 * @module autoscroll
 */

/** How deep the band at each edge reaches, in CSS pixels. */
export const AUTOSCROLL_ZONE_PX = 64;

/**
 * The most one frame may scroll, in CSS pixels.
 *
 * At 60fps this is a little over 1,000px per second at the rim — brisk enough to
 * cross a long page without waiting, and slow enough that releasing within a few
 * frames of the intended block is still accurate.
 */
export const AUTOSCROLL_MAX_STEP_PX = 18;

/**
 * How far the canvas should scroll this frame, in CSS pixels.
 *
 * Negative scrolls towards the top of the document, positive towards the bottom,
 * and `0` means the pointer is in the middle where nothing should move.
 *
 * **Past the edge behaves like the edge.** A drag captures the pointer, so it
 * goes on reporting positions after it has left the container entirely. Those
 * arrive as coordinates beyond `top` or `bottom`, and letting them scale would
 * make the speed depend on how far outside the window the author's hand happens
 * to be — unbounded, and not a distance they can judge. Clamped, leaving the
 * container simply means "as fast as this goes".
 *
 * **A short container cannot scroll both ways at once.** When the two bands
 * would overlap — a canvas less than twice the band deep — the effective band
 * shrinks to half the height, so the midpoint stays a place where nothing moves.
 * Without that, the same pointer sits inside both bands and whichever is tested
 * first wins, which reads as a canvas that scrolls in whichever direction the
 * code happened to check.
 *
 * @param pointerY - the pointer's client Y
 * @param top - the container's client top edge
 * @param bottom - the container's client bottom edge
 * @param zone - how deep the band reaches from each edge
 * @param maxStep - the speed at the rim
 * @returns pixels to scroll this frame; negative is up
 */
export function autoscrollStep(
  pointerY: number,
  top: number,
  bottom: number,
  zone: number = AUTOSCROLL_ZONE_PX,
  maxStep: number = AUTOSCROLL_MAX_STEP_PX
): number {
  const height = bottom - top;
  // A container with no height has no inside, so no position within it can be
  // near an edge. Returning 0 rather than dividing by it.
  if (height <= 0 || zone <= 0 || maxStep <= 0) return 0;

  const band = Math.min(zone, height / 2);

  const intoTop = top + band - pointerY;
  if (intoTop > 0) return -ramp(intoTop, band, maxStep);

  const intoBottom = pointerY - (bottom - band);
  if (intoBottom > 0) return ramp(intoBottom, band, maxStep);

  return 0;
}

/**
 * The speed at a given depth into a band: linear, and never past `maxStep`.
 *
 * Linear rather than eased, because the author is aiming rather than watching an
 * animation — a curve that accelerates makes the same hand movement mean
 * different things at different depths, which is the opposite of controllable.
 */
function ramp(depth: number, band: number, maxStep: number): number {
  return Math.min(depth / band, 1) * maxStep;
}
