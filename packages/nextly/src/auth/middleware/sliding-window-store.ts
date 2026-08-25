/**
 * The auth limiter's default store: a sliding window held in this process.
 *
 * This is the algorithm the auth limiter has always used, moved behind
 * {@link RateLimitStore} so a deployment can replace it without replacing the
 * limiter. Nothing about the numbers changes — a deployment that configures no
 * store must be unable to tell this module exists.
 *
 * **It is correct only within one process.** Each instance keeps its own map,
 * so on a serverless or multi-pod deployment the effective limit becomes
 * `configured × instances`, and the instance count is elastic and invisible to
 * the operator. That is why the seam exists: the fix is a shared store, not a
 * better in-memory one.
 *
 * The methods return promises without being `async`: they satisfy an
 * asynchronous interface synchronously, and marking them `async` would claim an
 * await that never happens. The contract is async because a SHARED store is
 * reached over the network — not because this one needs to be.
 *
 * @module auth/middleware/sliding-window-store
 */

import type {
  RateLimitRecord,
  RateLimitStore,
} from "../../middleware/rate-limit";

/**
 * A sliding window of request timestamps per key.
 *
 * A timestamp array rather than a counter, because the window slides: a fixed
 * counter cannot say WHEN the oldest attempt ages out, and `resetAt` is what
 * the caller puts in `Retry-After`. Entries older than the window are pruned on
 * every increment, so an array stays bounded by the limit the caller enforces.
 */
export class SlidingWindowMemoryStore implements RateLimitStore {
  private readonly windows = new Map<string, number[]>();

  increment(key: string, windowMs: number): Promise<RateLimitRecord> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const kept = (this.windows.get(key) ?? []).filter(t => t > windowStart);

    // Unconditional: `increment` counts every attempt, which is what the REST
    // limiter wants. A caller that must not count a refused attempt uses
    // `consume` instead, where the decision and the record are one step.
    kept.push(now);
    this.windows.set(key, kept);

    // The oldest entry is what ages out first, so it decides when the window
    // slides forward. `kept` is never empty here — the push above guarantees
    // an entry — so this is the first attempt's own timestamp on a cold key.
    const oldest = kept[0] ?? now;
    return Promise.resolve({
      count: kept.length,
      resetTime: oldest + windowMs,
    });
  }

  /**
   * Record an attempt only if it stays within `limit`.
   *
   * Atomic by construction: this runs to completion inside one turn of the
   * event loop, so nothing can observe the window between the count and the
   * push. That is the whole reason the decision lives in the store rather than
   * in the limiter — a limiter that counted here and recorded after an await
   * would leave a gap for another request to slip through.
   */
  consume(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitRecord & { allowed: boolean }> {
    const now = Date.now();
    const kept = (this.windows.get(key) ?? []).filter(t => t > now - windowMs);
    const allowed = kept.length < limit;

    // Only an allowed attempt is recorded, so a refused caller cannot push its
    // own window forward by continuing to hammer — which would otherwise let
    // them hold a key locked out indefinitely.
    if (allowed) {
      kept.push(now);
      this.windows.set(key, kept);
    } else if (kept.length > 0) {
      // Still store the pruned array: dropping entries that aged out is what
      // lets the window slide even while every attempt is being refused.
      this.windows.set(key, kept);
    }

    const oldest = kept[0] ?? now;
    return Promise.resolve({
      allowed,
      count: kept.length,
      resetTime: oldest + windowMs,
    });
  }

  reset(key: string): Promise<void> {
    this.windows.delete(key);
    return Promise.resolve();
  }

  /** Keys currently tracked. For tests and monitoring only. */
  get size(): number {
    return this.windows.size;
  }
}
