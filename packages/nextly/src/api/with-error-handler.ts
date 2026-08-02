// `unstable_rethrow` is loaded lazily on first use via `createRequire`
// (CommonJS-style resolution). Why not a regular static or dynamic
// `import "next/navigation"`?
//
//   - Static `import { x } from "next/navigation"` chokes Node's strict
//     ESM resolver when this package is loaded as an external via
//     `serverExternalPackages` (Next.js 16 doesn't list `./navigation`
//     in its package.json `exports` field).
//   - The `.js`-suffix variant fixes Node ESM but makes Turbopack's
//     bundler descend into Next.js internals that aren't on disk.
//   - Plain `await import("next/navigation")` shifts the same Node ESM
//     resolution failure from load time to call time — still crashes.
//
// `createRequire(import.meta.url)` falls back to Node's CommonJS
// resolver, which finds `node_modules/next/navigation.js` directly.
// Turbopack treats `createRequire` as opaque (it doesn't follow the
// require path at build time), so neither side complains. References
// cached at module scope so the resolution cost is paid once.
import { createRequire } from "node:module";

import { isDbError } from "../database/errors";
import { NextlyError } from "../errors/nextly-error";
import {
  currentFlattenedErrors,
  logFlattenedErrors,
  withSideEffectWarnings,
} from "../hooks/side-effect-warnings";
import { getNextlyLogger } from "../observability/logger";
import { getGlobalOnError, type OnErrorHook } from "../observability/on-error";

import { readOrGenerateRequestId } from "./request-id";

type UnstableRethrow = (err: unknown) => void;
let cachedUnstableRethrow: UnstableRethrow | null = null;
function getUnstableRethrow(): UnstableRethrow {
  if (cachedUnstableRethrow) return cachedUnstableRethrow;
  const require = createRequire(import.meta.url);
  const mod = require("next/navigation") as {
    unstable_rethrow: UnstableRethrow;
  };
  cachedUnstableRethrow = mod.unstable_rethrow;
  return cachedUnstableRethrow;
}

type WithErrorHandlerOptions = {
  /** Per-call observability hook. Fired before the global hook. */
  onError?: OnErrorHook;
  /** Public message used when wrapping unknown errors. Default: generic. */
  internalErrorMessage?: string;
};

const DEFAULT_INTERNAL_MESSAGE = "An unexpected error occurred.";

/**
 * HTTP boundary wrapper for Next.js App Router Route Handlers.
 *
 * Responsibilities (in order, per spec §11.2):
 * 1. Read or generate a Stripe-style `requestId` for this request.
 * 2. Run the handler.
 * 3. On thrown values: pass Next.js sentinel errors (`redirect`, `notFound`,
 *    dynamic-API bailouts) through `unstable_rethrow` first.
 * 4. Otherwise classify: `NextlyError` directly, `DbError` via the safety
 *    net, anything else wrapped as `NextlyError.internal`.
 * 5. Log the classified error.
 * 6. Fire the per-call `onError` hook, then the global one. Hook failures
 *    are logged but never poison the response.
 * 7. Serialize via `toResponseJSON(requestId)` with `application/problem+json`
 *    content type, the response status, and `X-Request-Id`. `Retry-After`
 *    is set for `RATE_LIMITED`.
 *
 * Generic over `TArgs` so it transparently supports both static handlers
 * (`(req)`) and dynamic-segment handlers (`(req, { params })`).
 */

/**
 * The detail an author cannot see from a public error response.
 *
 * Built only for a development response. `logContext` and `cause` are what the
 * public shape deliberately withholds, so this exists to shorten the loop
 * between a failure and its cause while writing code -- not to be a second
 * error surface. A cause is reduced to its message: a serialized stack is
 * large, and the log already has the whole thing against the same request id.
 *
 * Returns undefined when there is nothing to add, so an ordinary development
 * error response is the same shape a production one is.
 */

/**
 * Whether an error response may carry the detail the public shape withholds.
 *
 * Two signals, both required. `NODE_ENV` is not sufficient on its own because
 * this package is published pre-built and app builds keep it external, so the
 * check runs at runtime and a misconfigured production deployment would
 * satisfy it. `NEXTLY_DEV_DIAGNOSTICS` is named for exactly one purpose, so
 * nothing sets it incidentally.
 *
 * Read per call rather than cached, so a test can exercise both sides and so a
 * process cannot latch the permissive answer from however it happened to start.
 */

/**
 * A value that is safe to put on a response body, or undefined.
 *
 * `logContext` is whatever a thrower attached, so it can hold a cycle, a
 * BigInt, or anything else `JSON.stringify` refuses. Serializing the response
 * happens after this, inside the error path, so a value that throws there
 * would reject the request instead of returning the error the handler built --
 * turning a diagnostic aid into a failure worse than the one it describes.
 *
 * Round-tripped rather than inspected: that is the same operation the response
 * will perform, so it answers the exact question rather than an approximation
 * of it.
 */
function jsonSafe(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return "[unserializable]";
  }
}

function devDiagnosticsEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.NEXTLY_DEV_DIAGNOSTICS === "1"
  );
}

function buildDevDiagnostics(
  thrown: NextlyError,
  flattened: readonly NextlyError[]
): Record<string, unknown> | undefined {
  const causeMessage = (error: NextlyError): string | undefined =>
    error.cause instanceof Error ? error.cause.message : undefined;

  const detail: Record<string, unknown> = {};
  const context = jsonSafe(thrown.logContext);
  if (context !== undefined) detail.logContext = context;
  const thrownCause = causeMessage(thrown);
  if (thrownCause !== undefined) detail.cause = thrownCause;

  // Errors the envelope flattened before this frame. Without them the response
  // names only the boundary's reconstruction, which is the defect that makes
  // every unexpected failure look alike.
  const earlier = flattened.map(error => ({
    code: error.code,
    ...(jsonSafe(error.logContext) !== undefined
      ? { logContext: jsonSafe(error.logContext) }
      : {}),
    ...(causeMessage(error) !== undefined
      ? { cause: causeMessage(error) }
      : {}),
  }));
  if (earlier.length > 0) detail.flattened = earlier;

  return Object.keys(detail).length > 0 ? detail : undefined;
}

export function withErrorHandler<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>,
  options?: WithErrorHandlerOptions
): (...args: TArgs) => Promise<Response> {
  const internalMessage =
    options?.internalErrorMessage ?? DEFAULT_INTERNAL_MESSAGE;

  return async (...args: TArgs): Promise<Response> => {
    const req = args[0] as Request;
    const requestId = readOrGenerateRequestId(req);
    const route = (() => {
      try {
        return new URL(req.url).pathname;
      } catch {
        return undefined;
      }
    })();
    const method = req.method;
    let response: Response;
    // Captured inside the scope below, because it closes before the catch that
    // reads this. Development-only detail is built from it.
    let flattenedInRequest: NextlyError[] = [];

    try {
      // Opens the post-commit warning scope for the standalone handlers this
      // package exports for direct re-export (`nextly/api/singles-detail` and
      // friends). Those never pass through `createDynamicHandlers`, so without
      // this a hook that failed after their write committed would be logged
      // and dropped while the equivalent dynamic route reported it.
      //
      // Scopes nest, so a handler reached through the dynamic router is inside
      // that request's scope as well and the failure still reaches both.
      ({ result: response } = await withSideEffectWarnings(async () => {
        try {
          return await handler(...args);
        } finally {
          // Captured, not logged, and inside the scope because it closes when
          // this returns. In a `finally` because a request that flattened an
          // error and then threw is exactly the one whose detail an operator
          // needs. Writing them happens once the response is final, so the id
          // in the log is the one the caller actually receives.
          flattenedInRequest = currentFlattenedErrors();
        }
      }));
    } catch (err) {
      // (1) Re-throw Next.js sentinels FIRST. Without this, `redirect()` /
      // `notFound()` inside a handler get silently converted to 500s.
      // `getUnstableRethrow` resolves via `createRequire` (see top of
      // file for the dual-resolution rationale). Synchronous now.
      getUnstableRethrow()(err);

      // (2) Classify.
      let nextlyErr: NextlyError;
      if (NextlyError.is(err)) {
        nextlyErr = err;
      } else if (isDbError(err)) {
        // Safety net: a DbError reaching the API layer means the service /
        // repository didn't convert. Wrap and warn so the gap is visible.
        getNextlyLogger().warn({
          kind: "stray-db-error-converted",
          requestId,
          route,
          method,
          dbKind: err.kind,
        });
        nextlyErr = NextlyError.fromDatabaseError(err);
      } else {
        nextlyErr = NextlyError.internal({ cause: err as Error });
      }

      // (3) Log.
      //
      // Guarded because `logContext` is whatever a thrower attached and the
      // default logger serializes its payload: a cycle or a BigInt in there
      // would throw from inside this catch and reject the request, so the
      // caller would get nothing instead of the error the handler built. The
      // same reason the hooks below are described as never poisoning the
      // response.
      try {
        getNextlyLogger().error({
          kind: "route-handler-error",
          ...nextlyErr.toLogJSON(requestId),
          route,
          method,
        });
      } catch {
        // Deliberately swallowed; see above.
      }

      // (4) Fire hooks (per-call before global). Failures are logged but never
      // poison the response.
      const ctx = {
        kind: "route-handler" as const,
        requestId,
        route,
        method,
        request: req,
      };
      if (options?.onError) {
        try {
          await options.onError(nextlyErr, ctx);
        } catch (hookErr) {
          getNextlyLogger().warn({
            kind: "onError-hook-failed",
            layer: "per-call",
            requestId,
            err: String(hookErr),
          });
        }
      }
      const globalHook = getGlobalOnError();
      if (globalHook) {
        try {
          await globalHook(nextlyErr, ctx);
        } catch (hookErr) {
          getNextlyLogger().warn({
            kind: "onError-hook-failed",
            layer: "global",
            requestId,
            err: String(hookErr),
          });
        }
      }

      // (5) Serialize. For INTERNAL_ERROR with a custom internalMessage option,
      // override the public message at the wire-format step.
      const responseJson = nextlyErr.toResponseJSON(requestId);
      if (
        nextlyErr.code === "INTERNAL_ERROR" &&
        options?.internalErrorMessage !== undefined
      ) {
        responseJson.message = internalMessage;
      }
      // Development-only diagnostics, gated on TWO independent signals.
      //
      // `nextly` ships as a pre-built package and app builds keep it external,
      // so nothing rewrites this file: `NODE_ENV` is read at runtime, and a
      // production deployment started with the wrong value would otherwise
      // disclose the detail the public shape exists to withhold. So the gate
      // also requires an explicitly named opt-in that nothing sets by
      // accident, and neither signal alone is enough.
      //
      // Same shape as the dev auto-login, which is the more dangerous feature
      // of the two and is already guarded this way: an explicit opt-in plus a
      // production block, rather than an environment name on its own.
      //
      // Carries the thrown error's own context and anything the envelope
      // flattened on the way here, which is what an author cannot otherwise
      // see without reading the server log.
      if (devDiagnosticsEnabled()) {
        const devDetail = buildDevDiagnostics(nextlyErr, flattenedInRequest);
        if (devDetail) {
          (responseJson as Record<string, unknown>)._devDiagnostics = devDetail;
        }
      }
      const responseHeaders: Record<string, string> = {
        "content-type": "application/problem+json",
      };
      // Set Retry-After for rate-limited responses. Type-narrow on shape
      // rather than cast — defends against future PublicData variants.
      if (nextlyErr.code === "RATE_LIMITED") {
        const data = nextlyErr.publicData;
        if (
          data &&
          "retryAfterSeconds" in data &&
          typeof data.retryAfterSeconds === "number"
        ) {
          responseHeaders["retry-after"] = String(data.retryAfterSeconds);
        }
      }
      response = new Response(JSON.stringify({ error: responseJson }), {
        status: nextlyErr.statusCode,
        headers: responseHeaders,
      });
    }

    // Always set X-Request-Id on the way out, unless the handler already did.
    if (!response.headers.has("x-request-id")) {
      response.headers.set("x-request-id", requestId);
    }

    // Written here rather than where they were collected, for two reasons.
    //
    // The id: a handler may put its own `X-Request-Id` on the response, which
    // is preserved above. Logging the request-derived one would hand the
    // operator an id the caller never saw, defeating the join this exists for,
    // so the effective one is read back off the response.
    //
    // The guard: this is observability, and a logger that throws — a custom
    // one, or the default meeting a circular `logContext` — must not replace a
    // response the handler already produced. Losing a log line is recoverable;
    // turning a successful write into a 500 is not.
    logFlattenedErrors(
      flattenedInRequest,
      entry => getNextlyLogger().error(entry),
      {
        requestId: response.headers.get("x-request-id") ?? requestId,
        route,
        method,
      }
    );
    return response;
  };
}
