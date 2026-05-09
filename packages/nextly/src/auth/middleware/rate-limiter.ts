/**
 * API Key Rate Limiter
 *
 * Lightweight in-memory sliding-window rate limiter scoped to API key IDs.
 * Each key tracks its own sliding window of request timestamps; old entries
 * are pruned on every `check()` call so the array stays bounded at `limit`
 * entries; no background cleanup interval is needed.
 *
 * Intended for per-key rate limiting of API key authenticated requests.
 * Session-based requests are not rate-limited by this module.
 *
 * @module auth/middleware/rate-limiter
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { rateLimiter } from './rate-limiter';
 *
 * const result = rateLimiter.check(keyId, 1000, 3_600_000);
 * if (!result.allowed) {
 *   // return 429 with Retry-After header
 * }
 * ```
 */

/**
 * Result of a sliding-window rate limit check.
 */
export interface RateLimitCheckResult {
  /** Whether the request is allowed within the current window. */
  allowed: boolean;
  /** Number of requests remaining in the current window. */
  remaining: number;
  /** The Date at which the oldest in-window timestamp expires and the window slides forward. */
  resetAt: Date;
}

/**
 * In-memory sliding-window rate limiter keyed by API key ID.
 *
 * Each key maintains a sorted array of request timestamps (ms since epoch).
 * On every `check()` call:
 * 1. Timestamps older than `windowMs` are dropped.
 * 2. The remaining count is compared against `limit`.
 * 3. If allowed, the current timestamp is appended (keeping the array bounded).
 *
 * Memory is bounded: the array for any given key never exceeds `limit` entries
 * because entries are only added when the request is allowed.
 *
 * This class is safe to use as a module-level singleton within a single
 * Node.js process. For multi-instance deployments (serverless / multi-pod),
 * rate limit state is not shared across processes; this is an accepted
 * limitation.
 */
export class RateLimiter {
  /**
   * Internal store: keyId → sorted array of allowed request timestamps (ms).
   * Arrays are bounded at `limit` entries per key.
   */
  private readonly windows: Map<string, number[]> = new Map();

  /**
   * Check whether a request for `keyId` is allowed under the given rate limit.
   *
   * @param keyId   - The API key ID (used as the map key — NOT the raw key string).
   * @param limit   - Maximum number of requests allowed within `windowMs`.
   * @param windowMs - Sliding window size in milliseconds (e.g. 3_600_000 for 1 hour).
   * @returns `{ allowed, remaining, resetAt }`
   */
  check(keyId: string, limit: number, windowMs: number): RateLimitCheckResult {
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = this.windows.get(keyId) ?? [];

    timestamps = timestamps.filter(t => t > windowStart);

    const count = timestamps.length;
    const allowed = count < limit;

    if (allowed) {
      // Record this request only when allowed; keeps the array bounded at `limit`
      timestamps.push(now);
      this.windows.set(keyId, timestamps);
    }

    const remaining = Math.max(0, limit - timestamps.length);

    // resetAt = when the oldest in-window timestamp ages out of the window.
    // If the window is empty (first request was just allowed), reset is in `windowMs`.
    const oldestInWindow = timestamps[0];
    const resetAt = new Date(
      oldestInWindow !== undefined ? oldestInWindow + windowMs : now + windowMs
    );

    return { allowed, remaining, resetAt };
  }

  /**
   * Remove all state for a given key.
   *
   * Useful for tests or if a key is revoked and its slot should be freed
   * immediately rather than waiting for natural expiry.
   *
   * @param keyId - The API key ID whose window should be cleared.
   */
  clear(keyId: string): void {
    this.windows.delete(keyId);
  }

  /**
   * Return the number of keys currently tracked.
   * Intended for testing and monitoring only.
   */
  get size(): number {
    return this.windows.size;
  }
}

/**
 * Shared `RateLimiter` instance used by `requireApiKeyAuth()`.
 *
 * A module-level singleton is sufficient here: rate limit state is
 * per-process and API key auth middleware runs in the same process.
 * Instantiated once at module load; no DI registration needed.
 */
export const rateLimiter = new RateLimiter();
