/**
 * Rate limiting for the credential paths: auth writes and API keys.
 *
 * Sliding-window, keyed by API key id or by client IP. The window itself lives
 * in a {@link RateLimitStore}, so a deployment that spans more than one process
 * can supply a shared one and have the limit mean what it says.
 *
 * **Why that matters more here than on the REST limiter.** This is what stands
 * between an attacker and a login form. With per-process state on a serverless
 * deployment, every instance holds its own window and the effective limit
 * becomes `configured × instances` — a number the operator never chose and
 * cannot see. It fails OPEN, and only under load, which is what an attack looks
 * like.
 *
 * @module auth/middleware/rate-limiter
 */

import type { RateLimitStore } from "../../middleware/rate-limit";

import { SlidingWindowMemoryStore } from "./sliding-window-store";

/**
 * Result of a sliding-window rate limit check.
 */
export interface RateLimitCheckResult {
  /** Whether the request is allowed within the current window. */
  allowed: boolean;
  /** Number of requests remaining in the current window. */
  remaining: number;
  /** When the oldest in-window entry expires and the window slides forward. */
  resetAt: Date;
}

/**
 * A rate limiter over some store.
 *
 * Holds no state of its own — every window lives in the store — so
 * constructing one per request is free, and two limiters over the same store
 * enforce one shared limit.
 */
export class RateLimiter {
  constructor(
    private readonly store: RateLimitStore = new SlidingWindowMemoryStore()
  ) {}

  /**
   * Whether a request for `key` is allowed, recording it if so.
   *
   * Asynchronous because a shared store is reached over the network. That is
   * the contract every production limiter uses (`express-rate-limit` promisifies
   * synchronous stores rather than supporting them; `@upstash/ratelimit` is
   * HTTP-only by design) and it is the reason the previous synchronous
   * signature could never have taken a shared store.
   *
   * @param key      - API key id, or `auth-ip:<ip>`. Never a raw key string.
   * @param limit    - Maximum requests allowed within `windowMs`.
   * @param windowMs - Sliding window size in milliseconds.
   */
  async check(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitCheckResult> {
    // One atomic operation when the store offers it. The decision and the
    // record cannot be separated safely: with two calls there is an await
    // between them, and in that gap another request can start a new window that
    // the second call then corrupts.
    if (this.store.consume) {
      const consumed = await this.store.consume(key, limit, windowMs);
      return {
        allowed: consumed.allowed,
        remaining: Math.max(0, limit - consumed.count),
        resetAt: new Date(consumed.resetTime),
      };
    }

    // A store that cannot be atomic still gets a correct-but-stricter limiter:
    // every attempt counts, including refused ones. That costs a caller who has
    // exhausted their budget a longer wait than the atomic path would, and it
    // is the only degradation that fails CLOSED. The alternative — increment
    // then roll back — is the erasure this branch exists to avoid.
    const { count, resetTime } = await this.store.increment(key, windowMs);
    const allowed = count <= limit;

    return {
      allowed,
      remaining: Math.max(0, limit - count),
      resetAt: new Date(resetTime),
    };
  }

  /**
   * Drop all state for a key — a revoked key's slot, or a test's fixture.
   */
  async clear(key: string): Promise<void> {
    await this.store.reset(key);
  }
}

/**
 * The process-local limiter, used when no shared store is configured.
 *
 * Correct for a single-instance deployment and nothing else. See the module
 * note above for what it costs anywhere else.
 */
export const rateLimiter = new RateLimiter();

/**
 * The limiter to use for this request.
 *
 * Resolved per call rather than set once at boot, because config is loaded
 * after this module and a limiter captured at import time would be the
 * in-memory one forever — silently, and only in production, where boot order
 * differs from a test's.
 *
 * Returns the shared singleton when nothing is configured, so the default path
 * keeps one window map rather than building a new one per request.
 */
export function authRateLimiter(store?: RateLimitStore): RateLimiter {
  return store === undefined ? rateLimiter : new RateLimiter(store);
}
