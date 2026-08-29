/**
 * How long a cached read may live, given the next scheduled release.
 *
 * ## The problem neither ordinary mechanism solves
 *
 * A public route is served through `unstable_cache`, which offers two ways to
 * go stale: a tag someone busts, and a fixed number of seconds.
 *
 * For a SCHEDULED publish each fails differently. Tag-only means nothing
 * invalidates until the materialiser runs, so a page cached before the due
 * instant serves pre-release content INDEFINITELY if the runner is late,
 * wedged, or not deployed — silently, and invisibly in development where
 * nothing is cached. A fixed number of seconds is a guess unrelated to when
 * anything actually changes: short enough to catch a transition means
 * re-rendering constantly for sites that have never scheduled anything.
 *
 * ## The answer: derive the lifetime from the schedule
 *
 * The releases table already knows the earliest instant anything changes. A
 * page whose content has a release due in three hours may be cached for three
 * hours — not sixty seconds, and not forever. Busting tags at materialisation
 * still gives immediacy in the ordinary case; this gives a BOUND that cannot
 * outlive the schedule when it does not.
 *
 * The two are complements, not alternatives, and each covers the other's
 * failure mode.
 *
 * @module domains/releases/seconds-to-next-transition
 */

/**
 * The longest lifetime this will hand out, regardless of the schedule.
 *
 * A release scheduled for next year would otherwise produce an effectively
 * immortal cache entry, and the cache is not the only reason a page goes
 * stale — an ordinary edit does too, and that path relies on tags which a very
 * long-lived entry makes the sole line of defence for a year.
 *
 * A day is well past any interval a human waits on and well short of "never".
 */
export const MAX_CACHE_SECONDS = 24 * 60 * 60;

/**
 * Seconds a read may be cached for, or `false` for tag-only busting.
 *
 * `false` — not `0` — because that is what `unstable_cache` requires: it
 * rejects a zero lifetime, and the caller's own contract already spells
 * tag-only as `false`.
 *
 * @param earliest the earliest instant any scheduled release takes effect, or
 *   `null` when nothing is scheduled at all
 */
export function secondsToNextTransition(
  earliest: Date | null,
  now: Date
): number | false {
  // Nothing scheduled anywhere, which is every read on almost every site. The
  // cache behaves exactly as it did before releases existed.
  if (earliest === null) return false;

  const seconds = Math.ceil((earliest.getTime() - now.getTime()) / 1000);

  // Already due, and not yet materialised. A lifetime cannot be negative, and
  // rounding this to a small positive number would be worse than tag-only: it
  // would keep re-rendering a page whose content the read path is ALREADY
  // resolving correctly, since a due release is applied at read time.
  if (seconds <= 0) return false;

  return Math.min(seconds, MAX_CACHE_SECONDS);
}
