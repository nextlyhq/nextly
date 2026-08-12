/**
 * The mapping between a pointer on a picker surface and a colour.
 *
 * Kept apart from the component for two reasons. It is arithmetic on numbers,
 * so it belongs on the server-safe side with the rest of `@nextlyhq/ui/color`;
 * and a saturation square is the one part of a picker that cannot be checked by
 * rendering it — jsdom reports every element as zero-sized, so a component test
 * measures nothing and passes. Measured here instead, against known corners.
 *
 * @module lib/color/picker-geometry
 */

/** A position on a surface, each axis in [0, 1] from the top-left. */
export interface SurfacePoint {
  x: number;
  y: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * A pointer position as a fraction of a surface.
 *
 * Clamped, because a drag that begins inside the surface continues to report
 * while the pointer leaves it — which is the interaction people actually use to
 * reach full saturation, and without clamping it produces values outside the
 * colour space rather than the corner they are aiming at.
 *
 * A zero-sized surface answers the top-left rather than dividing by zero. That
 * happens in a test environment and on the first frame before layout.
 *
 * @experimental
 */
export function pointOnSurface(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
): SurfacePoint {
  return {
    x: rect.width === 0 ? 0 : clamp01((clientX - rect.left) / rect.width),
    y: rect.height === 0 ? 0 : clamp01((clientY - rect.top) / rect.height),
  };
}

/**
 * The saturation and value a point on the square stands for.
 *
 * Value runs UPWARD while a surface's y runs downward, so the vertical axis is
 * inverted here. Getting that wrong produces a picker that looks correct and
 * selects the colour vertically mirrored from the one under the cursor.
 *
 * @experimental
 */
export function saturationValueAt(point: SurfacePoint): {
  s: number;
  v: number;
} {
  return { s: clamp01(point.x), v: 1 - clamp01(point.y) };
}

/**
 * Where the handle sits for a given saturation and value — the inverse of
 * {@link saturationValueAt}.
 *
 * Derived from that function's own inversion rather than written independently,
 * so the two cannot disagree about which way the axis runs.
 *
 * @experimental
 */
export function surfacePointFor(s: number, v: number): SurfacePoint {
  return { x: clamp01(s), y: 1 - clamp01(v) };
}

/**
 * The hue a horizontal position stands for, in [0, 360).
 *
 * The upper bound is exclusive: 360 and 0 are the same hue, and returning 360
 * lets a handle at the far end read back as a position outside the strip.
 *
 * @experimental
 */
export function hueAt(fraction: number): number {
  const hue = clamp01(fraction) * 360;
  return hue >= 360 ? 0 : hue;
}

/** Where the hue handle sits, as a fraction of the strip. @experimental */
export function huePosition(hue: number): number {
  const wrapped = ((hue % 360) + 360) % 360;
  return wrapped / 360;
}
