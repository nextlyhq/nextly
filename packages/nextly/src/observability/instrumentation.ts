import { NextlyError } from "../errors/nextly-error";

import { getNextlyLogger, setNextlyLogger, type NextlyLogger } from "./logger";
import {
  getGlobalOnError,
  setGlobalOnError,
  type OnErrorHook,
} from "./on-error";

type InstrumentationOptions = {
  /** Process-wide observability hook (Sentry/Datadog/OTEL wiring). */
  onError?: OnErrorHook;
  /** Replace the default JSON-to-console logger. */
  logger?: NextlyLogger;
};

type RequestSummary = {
  path: string;
  method: string;
  headers: Headers;
};

type RouteContext = {
  routerKind: string;
  routePath: string;
  routeType: string;
};

/**
 * Helper for the developer's `app/instrumentation.ts`. Registers the logger
 * and global onError hook, and returns an `onRequestError` to re-export
 * from instrumentation so Next.js's framework-level error capture
 * (Server Components, middleware, Pages Router) flows through the unified
 * pipeline and pairs `error.digest` with our `requestId`.
 *
 * **Idempotency:** calling this twice in the same runtime overwrites the
 * prior logger / onError registration. In practice `instrumentation.ts`
 * runs once per Next.js runtime (Node and Edge get their own module graph),
 * so this is fine — but later calls win.
 *
 * **Framework-kind error wrapping:** when the global onError hook fires
 * with `kind: "framework"`, the `err` is always a NextlyError. If the
 * original framework error wasn't already a NextlyError, it gets wrapped
 * via `NextlyError.internal({ cause })`. Sentry-style handlers should read
 * `err.cause ?? err` to surface the original.
 *
 * Typical usage:
 *
 * ```ts
 * // app/instrumentation.ts
 * import { createNextlyInstrumentation } from "@revnixhq/nextly/observability";
 * import * as Sentry from "@sentry/nextjs";
 *
 * const nextly = createNextlyInstrumentation({
 *   onError: (err, ctx) =>
 *     Sentry.captureException(err.cause ?? err, {
 *       tags: { code: err.code, kind: ctx.kind },
 *       extra: { requestId: ctx.requestId, ...err.logContext },
 *     }),
 * });
 *
 * export const onRequestError = nextly.onRequestError;
 * ```
 */
export function createNextlyInstrumentation(opts?: InstrumentationOptions): {
  onRequestError: (
    error: unknown,
    request: RequestSummary,
    context: RouteContext
  ) => Promise<void>;
} {
  if (opts?.logger) setNextlyLogger(opts.logger);
  if (opts?.onError) setGlobalOnError(opts.onError);

  return {
    onRequestError: async (error, request, _context) => {
      const requestId =
        request.headers.get("x-request-id") ??
        request.headers.get("x-vercel-id") ??
        request.headers.get("cf-ray") ??
        "req_unknown";
      const digest = (error as { digest?: string }).digest;

      getNextlyLogger().error({
        kind: "next.requestError",
        requestId,
        digest,
        path: request.path,
        method: request.method,
        cause:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : { value: String(error) },
      });

      // Fire the global hook so external observability stacks (Sentry,
      // Datadog, OTEL) get framework-level errors too.
      const onError = getGlobalOnError();
      if (onError) {
        const nextlyErr = NextlyError.is(error)
          ? error
          : NextlyError.internal({ cause: error as Error });
        try {
          await onError(nextlyErr, { kind: "framework", requestId });
        } catch (hookErr) {
          getNextlyLogger().warn({
            kind: "onError-hook-failed",
            layer: "global",
            requestId,
            err: String(hookErr),
          });
        }
      }
    },
  };
}
