/**
 * Whether a value read earlier may still be served: the shared rule for a
 * cache that bounds how long another instance's change can go unseen.
 *
 * Time is measured with `performance.now()`, which only moves forward. A wall
 * clock (`Date.now()`) can step back when the host corrects it, and a value
 * read just before such a step would then look younger than it is, for as
 * long as the step was.
 *
 * @module shared/lib/lifetime
 */

/** Milliseconds on a clock that never steps back, for timing a lifetime. */
export function monotonicNow(): number {
  return performance.now();
}

/**
 * Whether a value read at `readAt` is still within `lifetimeMs` at `now`.
 * A value never read (`readAt` undefined) is not.
 */
export function isWithinLifetime(
  readAt: number | undefined,
  lifetimeMs: number,
  now: number = monotonicNow()
): boolean {
  return readAt !== undefined && now - readAt < lifetimeMs;
}
