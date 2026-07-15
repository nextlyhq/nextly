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

/** One field's complaint, as the validation envelope carries it. */
interface FieldError {
  path?: string;
  code?: string;
  message?: string;
}

/**
 * What to show a person for a failed request.
 *
 * A validation failure's `message` is "Validation failed.", which is true and
 * useless — the reasons are per-field, in `data.errors`. Reading the top-level
 * message alone tells someone their form was rejected without saying by what,
 * so the field messages come out in front where a reader will look.
 */
export function apiErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return "An error occurred";

  const apiError = err as ApiError;
  const errors = apiError.data?.errors;

  if (Array.isArray(errors)) {
    const reasons = (errors as FieldError[])
      .map(e => e?.message)
      .filter((m): m is string => typeof m === "string" && m.length > 0);

    if (reasons.length > 0) return reasons.join(" ");
  }

  return err.message || "An error occurred";
}
