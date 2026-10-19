/**
 * The error shape the auth middleware answers with, and its Response.
 *
 * Its own module so the REST limit can answer a spent key budget in the same
 * shape without importing the middleware that imports the limit.
 *
 * @module auth/middleware/error-response
 */

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
 * Create JSON error response.
 *
 * Any `headers` on the `ErrorResponse` are forwarded as HTTP response headers
 * and excluded from the JSON body (so clients never see an unexpected
 * `headers` field in the payload).
 */
export function createJsonErrorResponse(error: ErrorResponse): Response {
  const { headers: extraHeaders, ...bodyPayload } = error;
  const responseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  return new Response(JSON.stringify({ data: bodyPayload }), {
    status: error.statusCode,
    headers: responseHeaders,
  });
}
