/**
 * An API key's own rate limit (`apiKeys.rateLimit`).
 *
 * Its own module because two places spend it, authentication and the REST
 * limit, and the REST limit is imported by authentication.
 *
 * @module auth/middleware/api-key-budget
 */
import { container } from "@nextly/di/container";
import type { NextlyServiceConfig } from "@nextly/di/register";

import type { RateLimitStore } from "../../middleware/rate-limit";

import { createErrorResponse, type ErrorResponse } from "./error-response";
import { authRateLimiter } from "./rate-limiter";

/** Fallback maximum requests per sliding window (1 000 req/hour). */
const DEFAULT_RATE_LIMIT = 1_000;
/** Fallback sliding window size in milliseconds (1 hour). */
const DEFAULT_RATE_WINDOW_MS = 3_600_000;

/**
 * Safely get the registered Nextly config from the DI container.
 *
 * Returns `undefined` if the container is not yet initialized (e.g., during
 * early bootstrap). Callers fall back to module-level defaults when `undefined`
 * is returned.
 */
function getConfig(): NextlyServiceConfig | undefined {
  try {
    if (container.has("config")) {
      return container.get<NextlyServiceConfig>("config");
    }
  } catch {
    // DI container not initialized yet — safe to ignore
  }
  return undefined;
}

/**
 * Where core's own limits count, as the container registered it, or the
 * app's own store from config where the container has none.
 */
function getCounts(
  cfg: NextlyServiceConfig | undefined
): RateLimitStore | undefined {
  try {
    if (container.has("coreRateLimitStore")) {
      return container.get<RateLimitStore>("coreRateLimitStore");
    }
  } catch {
    // DI container not initialized yet — safe to ignore
  }
  return cfg?.rateLimit?.store;
}

/**
 * The 429 an API key has earned, or `null` when it is still within budget,
 * spending one request of it.
 *
 * Exported for the REST limit, which counts a resolved key against this one
 * budget, so a key is counted once per request wherever it is counted.
 *
 * Extracted so the decision — read config, ask the limiter, shape the refusal —
 * is one thing in one place rather than a third of `requireApiKeyAuth`.
 *
 * The limiter is resolved per call rather than captured at import: config is
 * registered after this module loads, so one bound at module scope would be the
 * in-memory limiter forever — silently, and only in production, where boot
 * order differs from a test's.
 */
export async function apiKeyRateLimitRefusal(
  keyId: string
): Promise<ErrorResponse | null> {
  const cfg = getConfig();
  const limit = cfg?.apiKeys?.rateLimit.requestsPerHour ?? DEFAULT_RATE_LIMIT;
  const windowMs = cfg?.apiKeys?.rateLimit.windowMs ?? DEFAULT_RATE_WINDOW_MS;

  const rl = await authRateLimiter(getCounts(cfg)).check(
    keyId,
    limit,
    windowMs
  );
  if (rl.allowed) return null;

  return createErrorResponse(
    429,
    "Too Many Requests",
    "Rate limit exceeded for this API key",
    {
      "Retry-After": String(
        Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)
      ),
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": "0",
    }
  );
}
