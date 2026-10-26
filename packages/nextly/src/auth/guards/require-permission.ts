import { createJsonErrorResponse as answerRefusal } from "../middleware/error-response";

export interface ErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  error: string;
  data: null;
  headers?: Record<string, string>;
}

/**
 * Create a JSON error response object.
 */
export function createErrorResponse(
  statusCode: number,
  message: string,
  error: string
): ErrorResponse {
  return { success: false, statusCode, message, error, data: null };
}

/**
 * Create a JSON Response from an ErrorResponse: the one error body every
 * refusal is answered with, as the auth middleware answers it.
 *
 * These guards put what a caller should read in `message` and the HTTP
 * reason in `error` (`"Missing API key"`, `"Unauthorized"`), the other way
 * round from the middleware, so `message` is the one answered.
 *
 * Pass the `request` to answer with its own request id (`x-request-id`, or a
 * proxy's); without it a new id is made.
 */
export function createJsonErrorResponse(
  errResp: ErrorResponse,
  request?: Request
): Response {
  return answerRefusal({ ...errResp, error: errResp.message }, request);
}

/**
 * Check if a value is an ErrorResponse.
 */
export function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    (value as ErrorResponse).success === false &&
    "statusCode" in value
  );
}
