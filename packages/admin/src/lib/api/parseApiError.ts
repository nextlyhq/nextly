/**
 * Shared API Error Parser
 *
 * Single source of truth for extracting error messages from API responses.
 * Handles all response shapes used across the backend:
 *
 * 1. `{ error: { message: "...", code: "..." } }` (object error)
 * 2. `{ error: "..." }` (flat string error)
 * 3. `{ data: { error: "..." } }` (nested data error)
 * 4. `{ data: { message: "..." } }` (nested data message)
 * 5. Fallback: stringify JSON
 */

export interface ApiError extends Error {
  status: number;
  code?: string;
}

/**
 * Parse an API error response into a typed ApiError.
 *
 * @param json - The parsed JSON body (or null if body parsing failed)
 * @param status - The HTTP status code
 * @returns An ApiError with message, status, and optional code
 */
export function parseApiError(json: unknown, status: number): ApiError {
  let errorMessage = `Request failed with status ${status}`;
  let code: string | undefined;

  if (json && typeof json === "object") {
    const body = json as Record<string, unknown>;

    // Shape 1: { error: { message: "...", code: "..." } }
    if (
      body.error &&
      typeof body.error === "object" &&
      typeof (body.error as Record<string, unknown>).message === "string" &&
      ((body.error as Record<string, unknown>).message as string).trim()
    ) {
      const errObj = body.error as Record<string, unknown>;
      errorMessage = errObj.message as string;
      if (typeof errObj.code === "string") {
        code = errObj.code;
      }
    }
    // Shape 2: { error: "..." }
    else if (typeof body.error === "string" && body.error.trim()) {
      errorMessage = body.error;
    }
    // Shape 3: { data: { error: "..." } }
    else if (
      body.data &&
      typeof body.data === "object" &&
      typeof (body.data as Record<string, unknown>).error === "string" &&
      ((body.data as Record<string, unknown>).error as string).trim()
    ) {
      errorMessage = (body.data as Record<string, unknown>).error as string;
    }
    // Shape 4: { data: { message: "..." } }
    else if (
      body.data &&
      typeof body.data === "object" &&
      typeof (body.data as Record<string, unknown>).message === "string" &&
      ((body.data as Record<string, unknown>).message as string).trim()
    ) {
      errorMessage = (body.data as Record<string, unknown>).message as string;
    }
    // Shape 5: Fallback — stringify the entire body
    else {
      try {
        errorMessage = JSON.stringify(json);
      } catch {
        errorMessage = "Unknown error: failed to parse server response.";
      }
    }
  }

  const error = new Error(errorMessage) as ApiError;
  error.status = status;
  if (code) {
    error.code = code;
  }
  return error;
}
