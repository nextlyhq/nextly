/**
 * Bridge helper for the Task 21 unified-error-system migration.
 *
 * The legacy auth middleware (`requireAuthentication`, `requirePermission`,
 * `requireAnyPermission`, `requireCollectionAccess`) returns a result-shape
 * `AuthContext | ErrorResponse` rather than throwing. Routes that have
 * adopted `withErrorHandler` need to surface the failure path as a thrown
 * `NextlyError` so the route boundary serializes the canonical
 * `application/problem+json` body. This module provides the conversion.
 *
 * Usage in a migrated route:
 * ```ts
 * const auth = await requireAuthentication(req);
 * if (isErrorResponse(auth)) throw toNextlyAuthError(auth);
 * ```
 *
 * The helper is short-lived: once the auth middleware itself is migrated to
 * throw `NextlyError` directly (separate task), this module is removed.
 */
import { NextlyError } from "../../errors/nextly-error";

import type { ErrorResponse } from "./index";

/**
 * Convert a legacy auth `ErrorResponse` to the equivalent `NextlyError`.
 *
 * Status-to-code mapping:
 * - 401 + code `TOKEN_EXPIRED` → `TOKEN_EXPIRED` so clients can refresh
 *   silently (per spec §13.6 the public message is the generic
 *   "Authentication required." regardless).
 * - 401 (other) → `AUTH_REQUIRED`.
 * - 403 → `FORBIDDEN`.
 * - 429 → `RATE_LIMITED`. The numeric `Retry-After` header (in seconds)
 *   is forwarded as `retryAfterSeconds` so `withErrorHandler` re-emits it.
 *   The header lookup is case-insensitive (per RFC 9110 §5.1) so any
 *   producer that emits `Retry-After` / `retry-after` / `RETRY-AFTER`
 *   feeds the bridge correctly. The legacy `X-RateLimit-Limit` /
 *   `X-RateLimit-Remaining` headers are not part of the unified error
 *   model and are dropped — acceptable trade-off for the migration;
 *   rate-limit detail lives in `logContext`.
 * - 503 → `SERVICE_UNAVAILABLE`.
 * - Anything else → `INTERNAL_ERROR` so the boundary maps to 500. The
 *   legacy status code is preserved in `logContext` for triage.
 *
 * The legacy `message` / `error` / `code` are kept in `logContext` so
 * operators can correlate the new wire payload with the original
 * middleware decision.
 */
export function toNextlyAuthError(legacy: ErrorResponse): NextlyError {
  const logContext: Record<string, unknown> = {
    legacyStatus: legacy.statusCode,
    legacyMessage: legacy.message,
    legacyError: legacy.error,
  };
  if (legacy.code) logContext.legacyCode = legacy.code;

  if (legacy.statusCode === 401) {
    if (legacy.code === "TOKEN_EXPIRED") {
      return new NextlyError({
        code: "TOKEN_EXPIRED",
        publicMessage: "Authentication required.",
        logContext,
      });
    }
    return NextlyError.authRequired({ logContext });
  }

  if (legacy.statusCode === 403) {
    return NextlyError.forbidden({ logContext });
  }

  if (legacy.statusCode === 429) {
    // Case-fold the lookup via Headers so producers using any casing of
    // "Retry-After" feed the bridge correctly. Header names on the wire are
    // case-insensitive (RFC 9110 §5.1).
    const headerLookup = legacy.headers
      ? new Headers(legacy.headers)
      : undefined;
    const retryAfterRaw = headerLookup?.get("retry-after") ?? undefined;
    const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) : undefined;
    return NextlyError.rateLimited({
      retryAfterSeconds:
        typeof retryAfterSeconds === "number" &&
        Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds
          : undefined,
      logContext,
    });
  }

  if (legacy.statusCode === 503) {
    return NextlyError.serviceUnavailable({ logContext });
  }

  // Unknown legacy status — preserve operator detail and surface as 500 so
  // the wire response stays canonical. Routes that need a different status
  // for a domain-specific failure should throw directly rather than rely
  // on the bridge.
  return NextlyError.internal({ logContext });
}
