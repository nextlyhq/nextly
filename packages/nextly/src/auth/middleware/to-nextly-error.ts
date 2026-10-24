/**
 * Bridge helper for legacy auth middleware that returns a result-shape
 * `AuthContext | ErrorResponse` rather than throwing. Routes that use
 * `withErrorHandler` need to surface the failure path as a thrown
 * `NextlyError` so the route boundary serializes the canonical
 * `application/problem+json` body. This module provides the conversion.
 *
 * Usage in a route:
 * ```ts
 * const auth = await requireAuthentication(req);
 * if (isErrorResponse(auth)) throw toNextlyAuthError(auth);
 * ```
 */
import { NextlyError } from "../../errors/nextly-error";

import type { ErrorResponse } from "./index";

/**
 * Convert a legacy auth `ErrorResponse` to the equivalent `NextlyError`.
 *
 * Status-to-code mapping:
 * - 401 + code `TOKEN_EXPIRED` -> `TOKEN_EXPIRED` so clients can refresh
 *   silently (per spec §13.6 the public message is the generic
 *   "Authentication required." regardless).
 * - 401 (other) -> `AUTH_REQUIRED`.
 * - 403 -> `FORBIDDEN`, with the middleware's own message, which names what
 *   was refused in the site's words and never a permission or a check.
 * - 429 -> `RATE_LIMITED`. The numeric `Retry-After` header (in seconds)
 *   is forwarded as `retryAfterSeconds` so `withErrorHandler` re-emits it.
 *   The header lookup is case-insensitive (per RFC 9110 section 5.1) so
 *   any producer that emits `Retry-After` / `retry-after` / `RETRY-AFTER`
 *   feeds the bridge correctly. The legacy `X-RateLimit-Limit` /
 *   `X-RateLimit-Remaining` headers are not part of the unified error
 *   model and are dropped; rate-limit detail lives in `logContext`.
 * - 503 -> `SERVICE_UNAVAILABLE`.
 * - Anything else -> `INTERNAL_ERROR` so the boundary maps to 500. The
 *   legacy status code is preserved in `logContext` for triage.
 *
 * The legacy `message` / `error` / `code`, and the refusal's `reason`, are
 * kept in `logContext` so operators can correlate the new wire payload with
 * the original middleware decision.
 */
export function toNextlyAuthError(legacy: ErrorResponse): NextlyError {
  const logContext = legacyLogContext(legacy);

  if (legacy.statusCode === 401) {
    if (legacy.code === "TOKEN_EXPIRED") {
      // Route through the factory so the expired-session code and its
      // canonical §13.6 public message stay defined in exactly one place.
      return NextlyError.tokenExpired({ logContext });
    }
    return NextlyError.authRequired({ logContext });
  }

  if (legacy.statusCode === 403) {
    // The middleware words every refusal for the caller (what was refused,
    // in the site's own words), so it is passed on.
    return new NextlyError({
      code: "FORBIDDEN",
      publicMessage: legacy.error || legacy.message,
      logContext,
    });
  }

  if (legacy.statusCode === 429) {
    return NextlyError.rateLimited({
      retryAfterSeconds: retryAfterSecondsOf(legacy),
      logContext,
    });
  }

  if (legacy.statusCode === 503) {
    return NextlyError.serviceUnavailable({ logContext });
  }

  // Unknown legacy status: preserve operator detail and surface as 500 so
  // the wire response stays canonical. Routes that need a different status
  // for a domain-specific failure should throw directly rather than rely
  // on the bridge.
  return NextlyError.internal({ logContext });
}

/**
 * What the middleware decided, for the log: its status, message, error and
 * code as it gave them, and which check refused, whatever the status.
 */
function legacyLogContext(legacy: ErrorResponse): Record<string, unknown> {
  return {
    legacyStatus: legacy.statusCode,
    legacyMessage: legacy.message,
    legacyError: legacy.error,
    ...(legacy.code ? { legacyCode: legacy.code } : {}),
    ...(legacy.reason ? { reason: legacy.reason } : {}),
  };
}

/**
 * A limit's `Retry-After`, in seconds, where it gives a number. Case-folded
 * through Headers, so producers using any casing of "Retry-After" feed the
 * bridge correctly: header names on the wire are case-insensitive (RFC 9110
 * section 5.1).
 */
function retryAfterSecondsOf(legacy: ErrorResponse): number | undefined {
  const raw = legacy.headers
    ? new Headers(legacy.headers).get("retry-after")
    : null;
  const seconds = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(seconds) ? seconds : undefined;
}
