/**
 * The refusal the auth middleware decides, and the Response it is answered
 * with: the one error body every other error uses.
 *
 * Its own module so the REST limit can answer a spent key budget in the same
 * shape without importing the middleware that imports the limit.
 *
 * @module auth/middleware/error-response
 */
import { buildErrorResponse } from "../../api/error-response";
import {
  generateRequestId,
  readOrGenerateRequestId,
} from "../../api/request-id";
import {
  NEXTLY_ERROR_STATUS,
  statusToErrorCode,
} from "../../errors/error-codes";
import { NextlyError } from "../../errors/nextly-error";
import { recordRefusalReason } from "../access/refusal-message";

/**
 * Standardized error response structure.
 *
 * The optional `headers` field carries HTTP response headers that should be
 * forwarded to the client (e.g. rate-limit headers on 429 responses). It is
 * stripped from the JSON body by `createJsonErrorResponse()`; callers do not
 * need to handle it separately.
 */
export interface ErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  error: string;
  data: null;
  /**
   * Machine-readable error code (e.g. "TOKEN_EXPIRED", "AUTH_REQUIRED").
   * Included in the JSON body so clients can distinguish "needs refresh"
   * from "fully unauthenticated" without parsing the human-readable message.
   */
  code?: string;
  /** Optional HTTP response headers (e.g. Retry-After, X-RateLimit-*). Excluded from JSON body. */
  headers?: Record<string, string>;
  /**
   * Which check refused, and why: logged on the server when the refusal is
   * answered, and never part of the answer.
   */
  reason?: string;
  /**
   * Authentication refused a request that carried no credential at all: no
   * session cookie and no key. Only such a request is a visitor; one whose
   * credential is not valid is asked to sign in again. Never part of the
   * answer, which says the same to both.
   */
  noCredential?: true;
}

/**
 * Create standardized error responses
 */
export function createErrorResponse(
  statusCode: number,
  message: string,
  error?: string,
  headers?: Record<string, string>,
  code?: string
): ErrorResponse {
  return {
    success: false,
    statusCode,
    message,
    error: error || message,
    data: null,
    ...(code && { code }),
    ...(headers && { headers }),
  };
}

/**
 * The refusal as a `NextlyError`: its own status and message, the code it
 * names where that is a known one (such as `TOKEN_EXPIRED`, which the admin
 * refreshes a session on), else the canonical code for its status, and a
 * limit's retry hint as the data every rate-limited answer carries.
 */
export function refusalError(refusal: ErrorResponse): NextlyError {
  const named = refusal.code;
  const retryAfter = Number(
    new Headers(refusal.headers ?? {}).get("retry-after") ?? Number.NaN
  );
  return new NextlyError({
    code:
      named !== undefined && Object.hasOwn(NEXTLY_ERROR_STATUS, named)
        ? named
        : statusToErrorCode(refusal.statusCode),
    statusCode: refusal.statusCode,
    publicMessage: refusal.error || refusal.message,
    ...(Number.isFinite(retryAfter)
      ? { publicData: { retryAfterSeconds: retryAfter } }
      : {}),
    logContext: { refusal: refusal.message, reason: refusal.reason },
  });
}

/**
 * Records which check refused, and why, on the server alone. Called where a
 * refusal is answered: by {@link createJsonErrorResponse} for a request, and
 * by `toNextlyAuthError` for a refusal thrown to its caller, which a standalone
 * route and a Direct API check do with no boundary of their own to log it.
 */
export function recordRefusal(
  refusal: ErrorResponse,
  requestId?: string
): void {
  recordRefusalReason({
    status: refusal.statusCode,
    code: refusal.code,
    reason: refusal.reason ?? refusal.message,
    ...(requestId === undefined ? {} : { requestId }),
  });
}

/**
 * The Response a refusal is answered with: `{ error: { code, message,
 * requestId } }` as `application/problem+json`, as every other error is.
 * Its `headers`, such as `Retry-After`, are sent as headers and never appear
 * in the body. The request id is the request's own where one is passed.
 */
export function createJsonErrorResponse(
  error: ErrorResponse,
  request?: Request
): Response {
  // One id for the answer and the log line, so a caller's report of the
  // answer finds the reason it was refused for.
  const requestId = request
    ? readOrGenerateRequestId(request)
    : generateRequestId();
  recordRefusal(error, requestId);
  return buildErrorResponse(refusalError(error), {
    requestId,
    headers: error.headers,
  });
}
