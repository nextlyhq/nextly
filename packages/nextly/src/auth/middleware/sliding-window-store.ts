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

    // Recorded before the caller has judged it. A caller that refuses the
    // attempt takes it back with `decrement`, which is what keeps a refused
    // request from extending its own window.
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

  decrement(key: string): Promise<void> {
    const timestamps = this.windows.get(key);
    if (timestamps === undefined || timestamps.length === 0) {
      return Promise.resolve();
    }
    // The LAST entry, because `increment` appends and this undoes that same
    // increment. Removing the oldest instead would slide the window forward on
    // every refusal, which is the opposite of what a refusal should do.
    timestamps.pop();
    if (timestamps.length === 0) this.windows.delete(key);
    else this.windows.set(key, timestamps);
    return Promise.resolve();
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
