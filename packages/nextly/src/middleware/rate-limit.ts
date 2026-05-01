/**
 * Rate Limiting Middleware
 *
 * Provides configurable rate limiting for API endpoints to protect
 * against abuse and ensure fair resource usage.
 *
 * Features:
 * - Pluggable store interface (in-memory default, Redis-compatible)
 * - Separate read/write limits
 * - Per-collection overrides
 * - Skip function for admin users
 * - Standard rate limit headers
 *
 * @module middleware/rate-limit
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * // Enable rate limiting in nextly.config.ts
 * export default defineConfig({
 *   rateLimit: {
 *     enabled: true,
 *     readLimit: 100,   // 100 GET requests per minute
 *     writeLimit: 30,   // 30 POST/PATCH/DELETE per minute
 *   },
 * });
 * ```
 */

import { getTrustedClientIp } from "../utils/get-trusted-client-ip";

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Result from a rate limit check.
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Maximum requests allowed in the window */
  limit: number;
  /** Remaining requests in current window */
  remaining: number;
  /** Unix timestamp (ms) when the window resets */
  resetTime: number;
}

/**
 * Pluggable store interface for rate limit state.
 *
 * Implement this interface to use Redis, Memcached, or other
 * distributed stores for rate limiting in production.
 *
 * @example
 * ```typescript
 * import Redis from 'ioredis';
 *
 * class RedisRateLimitStore implements RateLimitStore {
 *   private redis: Redis;
 *
 *   constructor(redis: Redis) {
 *     this.redis = redis;
 *   }
 *
 *   async increment(key: string, windowMs: number): Promise<RateLimitRecord> {
 *     const now = Date.now();
 *     const resetTime = now + windowMs;
 *     const count = await this.redis.incr(key);
 *     if (count === 1) {
 *       await this.redis.pexpire(key, windowMs);
 *     }
 *     return { count, resetTime };
 *   }
 *
 *   async reset(key: string): Promise<void> {
 *     await this.redis.del(key);
 *   }
 * }
 * ```
 */
export interface RateLimitStore {
  /**
   * Increment the request count for a key.
   *
   * @param key - Unique identifier (e.g., IP address or user ID)
   * @param windowMs - Time window in milliseconds
   * @returns Record with current count and reset time
   */
  increment(key: string, windowMs: number): Promise<RateLimitRecord>;

  /**
   * Reset the request count for a key.
   *
   * @param key - Unique identifier to reset
   */
  reset(key: string): Promise<void>;
}

/**
 * Record returned by store increment operation.
 */
export interface RateLimitRecord {
  /** Current request count in the window */
  count: number;
  /** Unix timestamp (ms) when the window resets */
  resetTime: number;
}

/**
 * Configuration for rate limiting.
 */
export interface RateLimitConfig {
  /**
   * Enable rate limiting.
   * @default true
   */
  enabled: boolean;

  /**
   * Maximum requests per window for read operations (GET).
   * @default 100
   */
  readLimit?: number;

  /**
   * Maximum requests per window for write operations (POST, PATCH, PUT, DELETE).
   * @default 30
   */
  writeLimit?: number;

  /**
   * Time window in milliseconds.
   * @default 60000 (1 minute)
   */
  windowMs?: number;

  /**
   * Custom store for rate limit state.
   * Defaults to in-memory store if not provided.
   *
   * @example
   * ```typescript
   * import { RedisRateLimitStore } from '@nextly/ratelimit-redis';
   *
   * rateLimit: {
   *   enabled: true,
   *   store: new RedisRateLimitStore(redisClient),
   * }
   * ```
   */
  store?: RateLimitStore;

  /**
   * Function to generate a unique key for rate limiting.
   * Defaults to the trusted client IP address (see `trustProxy` /
   * `trustedProxyIps`). Requests with no resolvable IP fall back to a
   * shared `unknown` bucket so anonymous traffic is still rate-limited.
   *
   * @param request - The incoming request
   * @returns A unique identifier string
   */
  keyGenerator?: (request: Request) => string;

  /**
   * Audit C4 / T-005: when true, the default keyGenerator parses
   * `X-Forwarded-For` (filtered through `trustedProxyIps`). When false
   * (default), proxy headers are ignored — direct-internet deployments
   * fall back to a single `unknown` bucket. Wired from
   * `nextly.config.ts → security.trustProxy`.
   *
   * @default false
   */
  trustProxy?: boolean;

  /**
   * Audit C4 / T-005: CIDR list of proxy IPs (from TRUSTED_PROXY_IPS).
   * Used by the default keyGenerator to walk the X-Forwarded-For chain
   * rightmost-first, returning the first non-proxy hop.
   */
  trustedProxyIps?: readonly string[];

  /**
   * Function to skip rate limiting for certain requests.
   * Returns true to skip rate limiting.
   *
   * By default, skips requests from authenticated admin users.
   *
   * @param request - The incoming request
   * @returns True to skip rate limiting
   *
   * @example
   * ```typescript
   * skip: (req) => {
   *   // Skip for internal service calls
   *   return req.headers.get('x-internal-key') === process.env.INTERNAL_KEY;
   * }
   * ```
   */
  skip?: (request: Request) => boolean | Promise<boolean>;

  /**
   * Per-collection rate limit overrides.
   *
   * @example
   * ```typescript
   * collections: {
   *   'media': { readLimit: 50, writeLimit: 10 },  // Stricter for media
   *   'logs': { readLimit: 200 },                   // More lenient for logs
   * }
   * ```
   */
  collections?: Record<
    string,
    {
      readLimit?: number;
      writeLimit?: number;
    }
  >;

  /**
   * Custom handler for rate limit exceeded responses.
   * If not provided, returns a standard 429 response.
   *
   * @param request - The rate-limited request
   * @param result - The rate limit check result
   * @returns A custom Response
   */
  handler?: (request: Request, result: RateLimitResult) => Response;
}

// ============================================================================
// In-Memory Store Implementation
// ============================================================================

/**
 * In-memory rate limit store.
 *
 * Suitable for development and single-instance deployments.
 * For production with multiple instances, use a Redis-backed store.
 *
 * @internal
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private hits: Map<string, { count: number; resetTime: number }> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodically clean up expired entries (every 60 seconds)
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);

    // Ensure cleanup interval doesn't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  async increment(key: string, windowMs: number): Promise<RateLimitRecord> {
    const now = Date.now();
    const record = this.hits.get(key);

    // If no record or window expired, start a new window
    if (!record || now > record.resetTime) {
      const newRecord = { count: 1, resetTime: now + windowMs };
      this.hits.set(key, newRecord);
      return newRecord;
    }

    // Increment existing record
    record.count++;
    return record;
  }

  async reset(key: string): Promise<void> {
    this.hits.delete(key);
  }

  /**
   * Clean up expired records to prevent memory leaks.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.hits.entries()) {
      if (now > record.resetTime) {
        this.hits.delete(key);
      }
    }
  }

  /**
   * Destroy the store and stop cleanup interval.
   * Call this when shutting down the application.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.hits.clear();
  }

  /**
   * Get the current size of the store (for testing/monitoring).
   */
  get size(): number {
    return this.hits.size;
  }
}

// ============================================================================
// Rate Limiter Factory
// ============================================================================

/**
 * Default configuration values.
 */
const DEFAULTS = {
  readLimit: 600, // 10 req/s burst — admin UI makes many parallel GETs on load
  writeLimit: 120,
  windowMs: 60000, // 1 minute
} as const;

/**
 * Build the default keyGenerator: returns the trusted client IP, or
 * the literal string `"unknown"` when no IP is available (so anonymous
 * traffic still shares one bucket rather than collapsing into a
 * unique-per-request key).
 *
 * Audit C4 / T-005: replaces a leftmost-XFF parser that any direct
 * attacker could rotate to bypass per-IP rate limits.
 */
function buildDefaultKeyGenerator(
  trustProxy: boolean,
  trustedProxyIps: readonly string[]
): (request: Request) => string {
  return request =>
    getTrustedClientIp(request, { trustProxy, trustedProxyIps }) ?? "unknown";
}

/**
 * Determine if the request is a read (GET) or write (POST/PATCH/PUT/DELETE) operation.
 */
function isReadOperation(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

/**
 * Extract collection name from request URL.
 *
 * Matches patterns like:
 * - /api/collections/{slug}/entries
 * - /admin/api/collections/{slug}/entries
 */
function extractCollectionFromUrl(url: string): string | null {
  const match = url.match(/\/collections\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Create a rate limiter middleware function.
 *
 * @param config - Rate limiting configuration
 * @returns Middleware function that checks rate limits
 *
 * @example
 * ```typescript
 * const rateLimiter = createRateLimiter({
 *   enabled: true,
 *   readLimit: 100,
 *   writeLimit: 30,
 * });
 *
 * // In route handler
 * const rateLimitResponse = await rateLimiter(request);
 * if (rateLimitResponse) {
 *   return rateLimitResponse; // 429 Too Many Requests
 * }
 * // Continue with request handling
 * ```
 */
export function createRateLimiter(config: RateLimitConfig) {
  // Early exit if not enabled
  if (!config.enabled) {
    return async (_request: Request): Promise<Response | null> => null;
  }

  // Initialize store (in-memory by default)
  const store = config.store ?? new InMemoryRateLimitStore();

  // Merge with defaults
  const readLimit = config.readLimit ?? DEFAULTS.readLimit;
  const writeLimit = config.writeLimit ?? DEFAULTS.writeLimit;
  const windowMs = config.windowMs ?? DEFAULTS.windowMs;
  const keyGenerator =
    config.keyGenerator ??
    buildDefaultKeyGenerator(
      config.trustProxy ?? false,
      config.trustedProxyIps ?? []
    );
  const skip = config.skip ?? (() => false);
  const collections = config.collections ?? {};
  const handler = config.handler;

  console.log(
    `[Nextly] Rate limiting enabled: ${readLimit} reads / ${writeLimit} writes per ${windowMs / 1000}s window`
  );

  /**
   * Rate limit middleware function.
   *
   * @param request - Incoming request to check
   * @returns Response if rate limited, null if allowed
   */
  return async (request: Request): Promise<Response | null> => {
    // Always skip lightweight system/health endpoints
    const url = new URL(request.url);
    const isSystemEndpoint =
      url.pathname.endsWith("/auth/setup-status") ||
      url.pathname.endsWith("/health");
    if (isSystemEndpoint) {
      return null;
    }

    // Check if should skip
    const shouldSkip = await skip(request);
    if (shouldSkip) {
      return null;
    }

    // Determine operation type and limit
    const method = request.method;
    const isRead = isReadOperation(method);
    let limit = isRead ? readLimit : writeLimit;

    // Check for per-collection overrides
    const collection = extractCollectionFromUrl(request.url);
    if (collection && collections[collection]) {
      const collectionConfig = collections[collection];
      if (isRead && collectionConfig.readLimit !== undefined) {
        limit = collectionConfig.readLimit;
      } else if (!isRead && collectionConfig.writeLimit !== undefined) {
        limit = collectionConfig.writeLimit;
      }
    }

    // Generate rate limit key
    const baseKey = keyGenerator(request);
    const operationType = isRead ? "read" : "write";
    const key = collection
      ? `ratelimit:${baseKey}:${collection}:${operationType}`
      : `ratelimit:${baseKey}:${operationType}`;

    // Check rate limit
    const record = await store.increment(key, windowMs);
    const remaining = Math.max(0, limit - record.count);
    const allowed = record.count <= limit;

    const result: RateLimitResult = {
      allowed,
      limit,
      remaining,
      resetTime: record.resetTime,
    };

    // If allowed, return null (continue with request)
    if (allowed) {
      return null;
    }

    // Rate limited - return 429 response
    if (handler) {
      return handler(request, result);
    }

    const retryAfter = Math.ceil((record.resetTime - Date.now()) / 1000);

    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Please try again later.",
          retryAfter,
        },
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(record.resetTime),
        },
      }
    );
  };
}

/**
 * Create rate limit headers for successful requests.
 *
 * Call this after checking rate limits to add headers to the response.
 *
 * @param result - The rate limit check result
 * @returns Headers object to merge with response
 *
 * @example
 * ```typescript
 * const response = new Response(JSON.stringify(data), {
 *   headers: {
 *     'Content-Type': 'application/json',
 *     ...createRateLimitHeaders(rateLimitResult),
 *   },
 * });
 * ```
 */
export function createRateLimitHeaders(
  result: RateLimitResult
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.resetTime),
  };
}

// ============================================================================
// Singleton Store (for shared state across requests)
// ============================================================================

let _defaultStore: InMemoryRateLimitStore | null = null;

/**
 * Get the default in-memory rate limit store.
 *
 * Returns a singleton instance to ensure rate limit state is shared
 * across all requests within the same process.
 *
 * @internal
 */
export function getDefaultStore(): InMemoryRateLimitStore {
  if (!_defaultStore) {
    _defaultStore = new InMemoryRateLimitStore();
  }
  return _defaultStore;
}

/**
 * Reset the default store (for testing purposes).
 *
 * @internal
 */
export function resetDefaultStore(): void {
  if (_defaultStore) {
    _defaultStore.destroy();
    _defaultStore = null;
  }
}
