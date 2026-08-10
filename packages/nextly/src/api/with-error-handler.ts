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

import { buildErrorResponse } from "./error-response";
import { readOrGenerateRequestId, withRequestIdHeader } from "./request-id";

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

      // (5) Serialize. The body, its development-only detail, `Retry-After`
      // and the content type belong to the shared builder, so a route reached
      // through this wrapper and one reached through the plugin dispatcher
      // answer with the same thing.
      //
      // `flattenedInRequest` is passed rather than read there: the scope it
      // comes from closed when the handler returned, so this frame is the last
      // one that can still see it.
      response = buildErrorResponse(nextlyErr, {
        requestId,
        ...(options?.internalErrorMessage !== undefined
          ? { internalMessage }
          : {}),
        flattened: flattenedInRequest,
      });
    }

    // Always set X-Request-Id on the way out, unless the handler already did.
    response = withRequestIdHeader(response, requestId);

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
