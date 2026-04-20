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

const HEALTH_CHECK_CACHE_SECONDS =
  typeof process !== "undefined" && process.env?.HEALTH_CHECK_CACHE_SECONDS
    ? Number(process.env.HEALTH_CHECK_CACHE_SECONDS)
    : 60;

/**
 * GET handler for health check endpoint.
 *
 * Returns comprehensive health status including:
 * - Database connectivity
 * - Query latency
 * - Timestamp
 * - Error details (if unhealthy)
 *
 * Response Codes:
 * - 200 OK: Database is healthy and responding
 * - 503 Service Unavailable: Database is unreachable or unhealthy
 *
 * @param request - Next.js Request object (unused, included for route handler signature)
 * @returns Response with JSON health status
 *
 * @example
 * ```bash
 * curl http://localhost:3000/api/health
 * # => {"ok":true,"timestamp":"2025-01-15T...","database":{...}}
 * ```
 */
export async function GET(request: Request): Promise<Response> {
  const health = await healthCheck();

  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      // Configurable cache duration to prevent excessive database queries
      // Allows stale responses for additional 30 seconds while revalidating
      "Cache-Control": `public, max-age=${HEALTH_CHECK_CACHE_SECONDS}, stale-while-revalidate=30`,
    },
  });
}

/**
 * HEAD handler for lightweight health check.
 *
 * Returns only HTTP status code and headers without body content.
 * Useful for simple availability checks and monitoring systems that
 * only need to verify the endpoint is responding.
 *
 * Response Codes:
 * - 200 OK: Database is healthy
 * - 503 Service Unavailable: Database is unhealthy
 *
 * @param request - Next.js Request object (unused, included for route handler signature)
 * @returns Response with no body, only status and headers
 *
 * @example
 * ```bash
 * curl -I http://localhost:3000/api/health
 * # => HTTP/1.1 200 OK
 * ```
 */
export async function HEAD(request: Request): Promise<Response> {
  const health = await healthCheck();

  return new Response(null, {
    status: health.ok ? 200 : 503,
    headers: {
      "Cache-Control": `public, max-age=${HEALTH_CHECK_CACHE_SECONDS}, stale-while-revalidate=30`,
    },
  });
}
