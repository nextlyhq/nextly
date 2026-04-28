/**
 * Health Check Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * a production-ready health check endpoint at /api/health.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/health/route.ts
 * export { GET, HEAD } from '@revnixhq/nextly/api/health';
 * ```
 *
 * @module api/health
 */

import { healthCheck } from "../database/health";
import { NextlyError } from "../errors/nextly-error";

import { createSuccessResponse } from "./create-success-response";
import { readOrGenerateRequestId } from "./request-id";
import { withErrorHandler } from "./with-error-handler";

const HEALTH_CHECK_CACHE_SECONDS =
  typeof process !== "undefined" && process.env?.HEALTH_CHECK_CACHE_SECONDS
    ? Number(process.env.HEALTH_CHECK_CACHE_SECONDS)
    : 60;

const HEALTH_CACHE_CONTROL = `public, max-age=${HEALTH_CHECK_CACHE_SECONDS}, stale-while-revalidate=30`;

/**
 * GET handler for health check endpoint.
 *
 * Returns the current database/runtime health on the canonical success wire
 * shape (`{ data: HealthCheckResult }`). When the underlying check reports
 * `ok: false`, the handler throws a 503 `SERVICE_UNAVAILABLE` `NextlyError`
 * so the route boundary serializes it as `application/problem+json`. The
 * unhealthy detail (latency, dialect, error string) is logged via
 * `logContext` rather than echoed to the public response — anonymous
 * monitoring scrapers should not learn implementation specifics.
 *
 * Response Codes:
 * - 200 OK: Database is healthy. Body: `{ data: { ok, timestamp, database } }`.
 * - 503 Service Unavailable: Database is unreachable or unhealthy. Body:
 *   `{ error: { code: "SERVICE_UNAVAILABLE", message, requestId } }`.
 *
 * @example
 * ```bash
 * curl http://localhost:3000/api/health
 * # => {"data":{"ok":true,"timestamp":"2025-01-15T...","database":{...}}}
 * ```
 */
export const GET = withErrorHandler(async (_request: Request) => {
  const health = await healthCheck();

  if (!health.ok) {
    // healthCheck() reports a soft failure (returned, not thrown) — translate
    // to a NextlyError so withErrorHandler emits the canonical problem+json
    // body. Operator detail goes to logs via logContext.
    throw NextlyError.serviceUnavailable({
      logMessage: "Health check failed",
      logContext: { health },
    });
  }

  return createSuccessResponse(health, {
    headers: { "Cache-Control": HEALTH_CACHE_CONTROL },
  });
});

/**
 * HEAD handler for lightweight health check.
 *
 * Returns only the HTTP status code and headers without body content. Useful
 * for monitoring systems that only need to verify the endpoint is responding.
 * HEAD is intentionally not wrapped in `withErrorHandler` because the wrapper
 * always emits a JSON body on the error path, which violates HEAD semantics
 * (per RFC 9110 HEAD responses must not include a body). Unexpected throws
 * propagate to Next.js's runtime; in production this surfaces as a 500 with
 * no body, matching the pre-migration behavior.
 *
 * `X-Request-Id` is set so log lines emitted by `healthCheck()` can be
 * correlated to a probe even though HEAD bypasses the route boundary.
 *
 * Response Codes:
 * - 200 OK: Database is healthy
 * - 503 Service Unavailable: Database is unhealthy
 *
 * @example
 * ```bash
 * curl -I http://localhost:3000/api/health
 * # => HTTP/1.1 200 OK
 * ```
 */
export async function HEAD(request: Request): Promise<Response> {
  const requestId = readOrGenerateRequestId(request);
  const health = await healthCheck();

  return new Response(null, {
    status: health.ok ? 200 : 503,
    headers: {
      "Cache-Control": HEALTH_CACHE_CONTROL,
      "X-Request-Id": requestId,
    },
  });
}
