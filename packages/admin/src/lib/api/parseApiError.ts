/**
 * Shared API Error Parser
 *
 * Reads the canonical wire shape (per spec §10.1):
 *   { error: { code, message, data?, requestId } }
 *
 * Anything else falls through to a generic UNKNOWN error.
 */

export interface ApiError extends Error {
  status: number;
  code?: string;
  data?: Record<string, unknown>;
  requestId?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function parseApiError(json: unknown, status: number): ApiError {
  if (
    isObject(json) &&
    isObject(json.error) &&
    typeof json.error.code === "string" &&
    typeof json.error.message === "string"
  ) {
    const error = new Error(json.error.message) as ApiError;
    error.status = status;
    error.code = json.error.code;
    error.data = isObject(json.error.data) ? json.error.data : undefined;
    error.requestId =
      typeof json.error.requestId === "string"
        ? json.error.requestId
        : undefined;
    return error;
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn("Non-canonical error response", json);
  }

  const error = new Error("Unexpected response from server.") as ApiError;
  error.status = status;
  error.code = "UNKNOWN";
  return error;
}
