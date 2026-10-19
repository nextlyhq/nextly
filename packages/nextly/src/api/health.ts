/**
 * Health Check Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * a production-ready health check endpoint at /api/health.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/health/route.ts
 * export { GET, HEAD } from 'nextly/api/health';
 * ```
 *
 * @module api/health
 */

import { healthCheck } from "../database/health";
import { isServicesRegistered } from "../di/register";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { getNextlyLogger } from "../observability/logger";

import { buildErrorResponse } from "./error-response";
import { readOrGenerateRequestId } from "./request-id";
import { respondData } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

// Per spec §7.7, health responses must include enough fields that the
// payload is not Boolean-only. We surface the package version and process
// uptime alongside the database probe so monitoring dashboards can read
// "this build, this long since restart" without a separate /version probe.
// `process.env.npm_package_version` is populated by package managers when the
// process is launched via `npm run`/`pnpm run`; in other launch modes it may
// be undefined, so we fall back to "unknown" rather than emitting null.
const PACKAGE_VERSION =
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  (typeof process !== "undefined" && process.env?.npm_package_version) ||
  "unknown";

function readUptimeSeconds(): number {
  // `process.uptime()` is only available in Node-like runtimes. Edge / non-Node
  // hosts return 0 here, which still keeps the body non-Boolean-only.
  if (typeof process === "undefined" || typeof process.uptime !== "function") {
    return 0;
  }
  return Math.floor(process.uptime());
}

const HEALTH_CHECK_CACHE_SECONDS =
  typeof process !== "undefined" && process.env?.HEALTH_CHECK_CACHE_SECONDS
    ? Number(process.env.HEALTH_CHECK_CACHE_SECONDS)
    : 60;

const HEALTH_CACHE_CONTROL = `public, max-age=${HEALTH_CHECK_CACHE_SECONDS}, stale-while-revalidate=30`;

/**
 * What an operator is told when this process answered before Nextly started.
 *
 * This route cannot start Nextly: it is handed no config. A server whose
 * Next.js `instrumentation.ts` starts Nextly in `register()` is never asked
 * before that finishes; one without it starts Nextly on the first request that
 * carries the config, and until then can only answer as if it could not serve.
 */
const NOT_STARTED =
  "Nextly has not started in this process, so the health check cannot run. " +
  "Start it when the server starts: an instrumentation.ts whose register() " +
  "calls createRegister(config) from 'nextly' (see the installation guide).";

/**
 * Each said once per process, so a monitor polling a server that cannot serve
 * does not flood the log. Kept apart, so a start that fails after a probe has
 * already reported "not started" is still logged with its own detail.
 */
const reported = { "not-started": false, failed: false };

/**
 * Where Nextly stands in this process: running, never started, or started and
 * failed.
 *
 * Every answer comes from `getCachedNextly()`, the one place that knows: it
 * waits for a start in progress, through every step of it (drift checks, boot
 * apply, seeding), before answering, and refuses with `CONFIGURATION_ERROR`
 * when nothing has started. A platform may run this route before
 * `instrumentation.register()` has finished, as Next.js on Vercel did before
 * vercel/next.js#94306, so a probe that arrives mid-start waits for the start
 * rather than answering for a server seconds from serving, or for one whose
 * start may yet fail.
 */
async function startState(): Promise<
  | { state: "started" }
  | { state: "not-started" }
  | { state: "failed"; error: unknown }
> {
  try {
    await getCachedNextly();
    return { state: "started" };
  } catch (error) {
    if (
      NextlyError.isCode(error, "CONFIGURATION_ERROR") &&
      !isServicesRegistered()
    ) {
      return { state: "not-started" };
    }
    return { state: "failed", error };
  }
}

/**
 * Says why this process cannot serve, once, at best effort: a logger that
 * cannot write must not turn the 503 into a 500. A failed start is logged with
 * its own detail, which nothing else here would surface.
 */
function reportUnavailable(
  status: { state: "not-started" } | { state: "failed"; error: unknown }
): void {
  if (reported[status.state]) return;
  try {
    const logger = getNextlyLogger();
    if (status.state === "not-started") {
      logger.warn({ op: "health-not-started", message: NOT_STARTED });
    } else {
      const error = status.error;
      logger.error({
        op: "health-start-failed",
        message: "Nextly failed to start in this process, so it cannot serve.",
        ...(NextlyError.is(error)
          ? {
              code: error.code,
              detail: error.logMessage,
              context: error.logContext,
            }
          : { detail: error instanceof Error ? error.message : String(error) }),
      });
    }
    reported[status.state] = true;
  } catch {
    // The 503 is the answer either way; the next probe tries the log again.
  }
}

/**
 * The database probe, or `null` when Nextly is not running in this process.
 *
 * Asked first rather than left to the probe, which would look the adapter up,
 * fail, and report a database fault for a server that was never started.
 */
async function probe(): Promise<Awaited<
  ReturnType<typeof healthCheck>
> | null> {
  const status = await startState();
  if (status.state !== "started") {
    reportUnavailable(status);
    return null;
  }
  return healthCheck();
}

/**
 * GET handler for health check endpoint.
 *
 * Returns the current database/runtime health as a bare object body via
 * `respondData`. The body merges the database probe with the package
 * version and process uptime so monitoring dashboards have a
 * non-Boolean-only payload to assert against (spec §5.1 rule 3 / §7.7).
 * When the underlying check reports `ok: false`, the handler throws a 503
 * `SERVICE_UNAVAILABLE` `NextlyError` so the route boundary serializes it
 * as `application/problem+json`. The unhealthy detail (latency, dialect,
 * error string) is logged via `logContext` rather than echoed to the
 * public response; anonymous monitoring scrapers should not learn
 * implementation specifics.
 *
 * Response Codes:
 * - 200 OK: Database is healthy. Body:
 *   `{ ok, version, uptime, timestamp, database }`.
 * - 503 Service Unavailable: Database is unreachable or unhealthy. Body:
 *   `{ error: { code: "SERVICE_UNAVAILABLE", message, requestId } }`.
 *
 * @example
 * ```bash
 * curl http://localhost:3000/api/health
 * # => {"ok":true,"version":"0.0.142","uptime":123,"timestamp":"...","database":{...}}
 * ```
 */
export const GET = withErrorHandler(async (request: Request) => {
  const health = await probe();

  if (health === null) {
    // Answered rather than thrown: the boundary logs every error thrown
    // through it, and a monitor polling a server that never starts Nextly
    // would log once per poll. `probe()` has said why, once per process.
    return buildErrorResponse(NextlyError.serviceUnavailable(), {
      requestId: readOrGenerateRequestId(request),
    });
  }

  if (!health.ok) {
    // healthCheck() reports a soft failure (returned, not thrown). Translate
    // to a NextlyError so withErrorHandler emits the canonical problem+json
    // body. Operator detail goes to logs via logContext.
    throw NextlyError.serviceUnavailable({
      logMessage: "Health check failed",
      logContext: { health },
    });
  }

  // Spread the database probe and add `version` and `uptime` so the body is
  // never Boolean-only. The spread keeps existing `ok / timestamp / database`
  // fields in their original positions for clients that already read them.
  return respondData(
    {
      ...health,
      version: PACKAGE_VERSION,
      uptime: readUptimeSeconds(),
    },
    {
      headers: { "Cache-Control": HEALTH_CACHE_CONTROL },
    }
  );
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
  const health = await probe();

  return new Response(null, {
    status: health?.ok ? 200 : 503,
    headers: {
      "Cache-Control": HEALTH_CACHE_CONTROL,
      "X-Request-Id": requestId,
    },
  });
}
