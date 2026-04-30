// `unstable_rethrow` is loaded lazily on first use. We can't use a
// static `import { unstable_rethrow } from "next/navigation"` here:
// the bare path fails Node's strict ESM resolution when this package
// is loaded as an external via `serverExternalPackages`, and the `.js`
// suffix variant makes Turbopack's bundler-side resolution unhappy
// (it follows the path into Next.js internals that don't exist in
// the file tree). Dynamic import works in both modes. We cache the
// reference at module scope so the resolution cost is paid once.
type UnstableRethrow = (err: unknown) => void;
let cachedUnstableRethrow: UnstableRethrow | null = null;
async function getUnstableRethrow(): Promise<UnstableRethrow> {
  if (cachedUnstableRethrow) return cachedUnstableRethrow;
  const mod = (await import("next/navigation")) as {
    unstable_rethrow: UnstableRethrow;
  };
  cachedUnstableRethrow = mod.unstable_rethrow;
  return cachedUnstableRethrow;
}

import { isDbError } from "../database/errors";
import { NextlyError } from "../errors/nextly-error";
import { getNextlyLogger } from "../observability/logger";
import { getGlobalOnError, type OnErrorHook } from "../observability/on-error";

import { readOrGenerateRequestId } from "./request-id";

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

    try {
      response = await handler(...args);
    } catch (err) {
      // (1) Re-throw Next.js sentinels FIRST. Without this, `redirect()` /
      // `notFound()` inside a handler get silently converted to 500s.
      // `getUnstableRethrow` is the dynamic-import version (see top of
      // file). Awaiting here is fine because we're already async.
      const unstable_rethrow = await getUnstableRethrow();
      unstable_rethrow(err);

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
      getNextlyLogger().error({
        kind: "route-handler-error",
        ...nextlyErr.toLogJSON(requestId),
        route,
        method,
      });

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
    return response;
  };
}
