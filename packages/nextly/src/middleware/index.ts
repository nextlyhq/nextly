/**
 * Middleware Module
 *
 * Exports middleware utilities for request processing.
 *
 * @module middleware
 * @since 1.0.0
 */

// Rate limiting
export {
  createRateLimiter,
  createRateLimitHeaders,
  getDefaultStore,
  resetDefaultStore,
  InMemoryRateLimitStore,
  type RateLimitConfig,
  type RateLimitStore,
  type RateLimitResult,
  type RateLimitRecord,
} from "./rate-limit";

// Security headers
export {
  createSecurityHeadersMiddleware,
  type SecurityHeadersConfig,
} from "./security-headers";

// CORS
export {
  createCorsMiddleware,
  type CorsConfig,
  type CorsMiddleware,
} from "./cors";
