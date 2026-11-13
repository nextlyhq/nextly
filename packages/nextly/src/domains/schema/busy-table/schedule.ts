/**
 * When each try for a busy table starts.
 *
 * After a try ends without the locks it needs, the change pauses and tries again. The pauses start
 * at about 1 second and double to at most about 15, so a holder that ends soon is met soon, and one
 * that does not is not asked again and again. No try starts unless a whole try still fits before
 * the total bound, measured from when the first try began. With the default bounds (5 seconds a
 * try, 90 in all) the tries start at about 0, 6, 13, 22, 35, 55 and 75 seconds: seven tries.
 *
 * Only the pauses are this module's; the clock is the caller's, so a try that ended early (the
 * holder let go) moves every later try earlier rather than keeping to a plan.
 *
 * @module domains/schema/busy-table/schedule
 */
import type { BusyTableBounds } from "./bounds";

/** The pauses after the first tries, in milliseconds; every later pause is the last of them. */
const PAUSES_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

/** The pause after try `tried` (0 for the first), in milliseconds. */
export function pauseAfterTry(tried: number): number {
  return PAUSES_MS[Math.min(tried, PAUSES_MS.length - 1)];
}

/**
 * Whether a try may start at `now`, the first having started at `firstStartedAt`: only while a
 * whole try still ends by the total bound.
 */
export function mayStartTry(
  bounds: BusyTableBounds,
  firstStartedAt: number,
  now: number
): boolean {
  return now + bounds.tryMs <= firstStartedAt + bounds.totalMs;
}

/**
 * When each try starts, in milliseconds from the first, where every try waits out its whole
 * bound: the most tries the bounds allow, as an operator plans them.
 */
export function plannedTryStarts(bounds: BusyTableBounds): number[] {
  const starts = [0];
  for (;;) {
    const tried = starts.length - 1;
    const next = starts[tried] + bounds.tryMs + pauseAfterTry(tried);
    if (!mayStartTry(bounds, 0, next)) return starts;
    starts.push(next);
  }
}
