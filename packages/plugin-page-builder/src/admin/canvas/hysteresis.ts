/**
 * Target-switch hysteresis for the canvas.
 *
 * With the pointer resting near a boundary between two drop zones, ownership
 * flipped on every pixel of jitter, so the insertion line strobed between two
 * targets and a drop landed wherever the pointer happened to be sampled. The
 * incumbent target now has to be beaten by a margin rather than by any amount
 * at all.
 *
 * A margin rather than a dwell. Both satisfy the requirement; a dwell charges
 * latency on every deliberate move and puts wall-clock dependence into the
 * canvas, while a margin costs nothing while the pointer moves decisively and
 * resists only near a boundary. It is also deterministic, which is what lets a
 * test assert the width instead of waiting for it to settle.
 */

/**
 * How far a challenger must beat the incumbent by, as a difference of distances
 * to the two candidates' centres.
 *
 * NOT pixels of pointer movement, and the distinction is a factor of two. The
 * comparison this feeds reduces to `dInc - dNew < band`, so the quantity bounded
 * is the DIFFERENCE between the two distances. For two equal zones whose centres
 * the pointer travels between, moving `x` past the boundary lengthens one
 * distance by `x` and shortens the other by `x`, so the difference grows at
 * twice the pointer's rate and this constant buys half its value in pointer
 * movement.
 *
 * That relation holds exactly only for equal zones on the line joining their
 * centres. It is therefore not used to derive the requirement: the spec asks for
 * 8-12px of pointer movement, and `hysteresis.test.ts` MEASURES what this
 * constant achieves rather than converting it, so the conversion is under test
 * instead of being assumed identically here and there.
 */
export const TARGET_SWITCH_BAND_CENTRE_DELTA_PX = 20;

/**
 * The incumbent's collision value, weakened by the band.
 *
 * Both default detectors report a value inversely proportional to the distance
 * from the droppable's centre to the pointer — `1 / d` for pointer containment,
 * `intersectionRatio / d` for shape overlap. Scaling by `d / (d - band)`
 * therefore applies the band in DISTANCE space for either of them, without this
 * code needing to know which one produced the number or to recompute it. The
 * band is expressed once, in pixels, and the library's own value carries
 * whatever else it encodes.
 *
 * Adding a constant instead would not work: an inverse is non-linear, so a fixed
 * bonus buys a pixel width that depends on how far the pointer already is.
 */
export function bandedValue(
  baseValue: number,
  distance: number,
  band: number
): number {
  // An unbeatable score stays unbeatable. Pointer containment reports exactly
  // `Infinity` when the pointer sits on a centre, with no guard of its own, and
  // scaling that would produce a finite number — leaving the incumbent WEAKER at
  // the one position where it is most clearly the right target, and inverting
  // the behaviour this function exists to add.
  if (!Number.isFinite(baseValue)) return baseValue;
  if (!Number.isFinite(distance) || distance < 0) return baseValue;
  if (!(band > 0)) return baseValue;

  const effective = distance - band;
  // Nearer its own centre than the band is wide. Clamped rather than left to go
  // negative or infinite: a negative divisor inverts the ranking, and an
  // infinite value ties with another infinite one to produce NaN in the
  // comparator, whose ordering is then undefined.
  if (effective <= Number.EPSILON) {
    return baseValue * (distance / Number.EPSILON);
  }
  return baseValue * (distance / effective);
}

/** Straight-line distance, the same measure the collision values are built on. */
export function centreDistance(
  centre: { x: number; y: number },
  pointer: { x: number; y: number }
): number {
  return Math.hypot(centre.x - pointer.x, centre.y - pointer.y);
}
