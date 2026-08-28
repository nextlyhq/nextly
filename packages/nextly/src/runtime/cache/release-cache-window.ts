/**
 * How long a cached public read may live, bounded by the next scheduled
 * release.
 *
 * ## Why the adapter is not read off the reader
 *
 * The obvious place to find the database is the `nextly` the caller passed —
 * and it is not there. `NextlyContentReader` is a deliberately narrow contract,
 * and the object `getNextly()` returns exposes no `adapter` property at all. A
 * bound that looked for one therefore found nothing on the DEFAULT path, which
 * is every real content route: inert exactly where it mattered, and present
 * everywhere it was tested in isolation.
 *
 * So the adapter is resolved the way the rest of the runtime resolves it —
 * from the container, under the name it is registered with. A runtime that has
 * registered none gets the null bound and the tag-only behaviour it had before
 * releases existed.
 *
 * ## Why both public routes call this and neither computes it
 *
 * Collections and Singles cache through separate `cachedFind` calls, and a
 * release member names either scope. A bound applied to one and not the other
 * is a Single that keeps serving its pre-release document — a failure visible
 * only in production, and only for the half nobody wired.
 *
 * @module runtime/cache/release-cache-window
 */

import { container } from "../../di/container";
import {
  NO_RELEASE_CACHE_BOUND,
  releaseCacheBoundFor,
} from "../../domains/releases/release-cache-bound";
import type { ReleaseCacheBound } from "../../domains/releases/release-cache-bound";

/**
 * The bound for the currently registered adapter, or the null bound.
 *
 * `container.has` rather than a try/catch: a runtime with no database is an
 * ordinary state for a reader, not an error to swallow.
 */
function currentBound(): ReleaseCacheBound {
  if (!container.has("adapter")) return NO_RELEASE_CACHE_BOUND;
  return releaseCacheBoundFor(container.get("adapter"));
}

/**
 * The `revalidate` a cached read should use, given what the caller asked for.
 *
 * The caller's own window still wins when it is SHORTER — a route that asked
 * for sixty seconds meant it. The release bound is a ceiling, not a
 * replacement: a page can never outlive the release that changes it, but may
 * be refreshed sooner for reasons of its own.
 */
export async function releaseBoundedRevalidate(
  callerRevalidate: number | false | undefined,
  now: Date = new Date()
): Promise<number | false> {
  // `unstable_cache` rejects a zero lifetime, and both callers' contracts
  // already spell tag-only as `false`.
  const caller =
    typeof callerRevalidate === "number" && callerRevalidate > 0
      ? callerRevalidate
      : false;

  const release = await currentBound().maxCacheSeconds(now);

  if (caller === false) return release;
  if (release === false) return caller;
  return Math.min(caller, release);
}
