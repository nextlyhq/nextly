// Next.js subpath imports use `createRequire` for dual-resolution
// safety. See packages/nextly/src/api/with-error-handler.ts for the
// full rationale — both Node ESM and Turbopack accept the
// CommonJS-style resolution path while neither accepts a single
// shared `import` statement.
import { createRequire } from "node:module";

type HeadersFn = () => Promise<{ get(name: string): string | null }>;
type UnstableRethrow = (err: unknown) => void;
let cachedHeaders: HeadersFn | null = null;
let cachedUnstableRethrow: UnstableRethrow | null = null;
function getHeaders(): HeadersFn {
  if (cachedHeaders) return cachedHeaders;
  const require = createRequire(import.meta.url);
  const mod = require("next/headers") as { headers: HeadersFn };
  cachedHeaders = mod.headers;
  return cachedHeaders;
}
function getUnstableRethrow(): UnstableRethrow {
  if (cachedUnstableRethrow) return cachedUnstableRethrow;
  const require = createRequire(import.meta.url);
  const mod = require("next/navigation") as {
    unstable_rethrow: UnstableRethrow;
  };
  cachedUnstableRethrow = mod.unstable_rethrow;
  return cachedUnstableRethrow;
}

import { generateRequestId } from "../api/request-id";
import { isDbError } from "../database/errors";
import { NextlyError } from "../errors/nextly-error";
import { getNextlyLogger } from "../observability/logger";
import { getGlobalOnError, type OnErrorHook } from "../observability/on-error";

import type { ActionResult } from "./action-result";

type WithActionOptions = {
  /** Per-call observability hook. Fired before the global hook. */
  onError?: OnErrorHook;
};

/**
 * Read an upstream-set request id via Next.js's `headers()` (the only path
 * Server Actions have to request-scoped headers), falling back to a freshly
 * generated id when no header is present or when called outside a request
 * scope (tests).
 */
async function readOrGenerateRequestIdFromHeaders(): Promise<string> {
  try {
    const headers = getHeaders();
    const h = await headers();
    return (
      h.get("x-request-id") ??
      h.get("x-vercel-id") ??
      h.get("cf-ray") ??
      generateRequestId()
    );
  } catch {
    return generateRequestId();
  }
}

/**
 * Server Action boundary wrapper. Mirrors `withErrorHandler` but returns a
 * typed `ActionResult<T>` instead of a `Response`, working around Next.js's
 * production error-digesting (which strips thrown error messages).
 *
 * Generic over `TArgs` so it transparently supports both direct-call
 * actions (`(id: string)`) and form-binding actions
 * (`(prevState, formData)`) consumed by `useActionState`.
 *
 * Sentinel errors (`redirect`, `notFound`, dynamic-API bailouts) are passed
 * through `unstable_rethrow` first so navigation works as expected.
 */
export function withAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options?: WithActionOptions
): (...args: TArgs) => Promise<ActionResult<TResult>> {
  return async (...args: TArgs): Promise<ActionResult<TResult>> => {
    const requestId = await readOrGenerateRequestIdFromHeaders();

    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (err) {
      // Re-throw Next.js sentinels FIRST so redirect()/notFound() inside an
      // action behave as expected. `getUnstableRethrow` resolves via
      // createRequire (see top of file for rationale).
      getUnstableRethrow()(err);

      // Classify.
      let nextlyErr: NextlyError;
      if (NextlyError.is(err)) {
        nextlyErr = err;
      } else if (isDbError(err)) {
        getNextlyLogger().warn({
          kind: "stray-db-error-converted",
          requestId,
          dbKind: err.kind,
        });
        nextlyErr = NextlyError.fromDatabaseError(err);
      } else {
        nextlyErr = NextlyError.internal({ cause: err as Error });
      }

      // Log.
      getNextlyLogger().error({
        kind: "server-action-error",
        ...nextlyErr.toLogJSON(requestId),
      });

      // Hooks (per-call before global). Failures are logged but never
      // poison the result.
      const ctx = { kind: "server-action" as const, requestId };
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

      return { ok: false, error: nextlyErr.toResponseJSON(requestId) };
    }
  };
}
