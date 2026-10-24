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
import { container } from "../../di/container";
import {
  NEXTLY_ERROR_STATUS,
  statusToErrorCode,
} from "../../errors/error-codes";
import { NextlyError } from "../../errors/nextly-error";
import { consoleLogger, type Logger } from "../../shared/types";

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

/** The installation's logger, or the console where none is registered. */
function logger(): Logger {
  try {
    if (container.has("logger")) return container.get<Logger>("logger");
  } catch {
    // The container is not initialized.
  }
  return consoleLogger;
}

/** Records which check refused, and why, on the server alone. */
function logRefusal(refusal: ErrorResponse): void {
  logger().info("[nextly] Refused a request", {
    status: refusal.statusCode,
    code: refusal.code,
    reason: refusal.reason ?? refusal.message,
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
  logRefusal(error);
  return buildErrorResponse(refusalError(error), {
    requestId: request ? readOrGenerateRequestId(request) : generateRequestId(),
    headers: error.headers,
  });
}
