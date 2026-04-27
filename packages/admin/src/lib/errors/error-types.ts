/**
 * Error Utility Functions
 *
 * Utilities for consistent error handling across the application.
 */

/**
 * Type guard to check if value is an Error object
 */
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Type guard to check if value is an object with a message property
 */
function isErrorWithMessage(
  error: unknown
): error is { message: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as Record<string, unknown>).message === "string"
  );
}

/**
 * Type guard to check if value is a Fetch API error
 */
function isFetchError(error: unknown): error is TypeError {
  return error instanceof TypeError && error.message.includes("fetch");
}

/**
 * Type guard to check if value is an API error response
 */
function isApiError(
  error: unknown
): error is { response?: { data?: { error?: string; message?: string } } } {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: unknown }).response === "object"
  );
}

/**
 * Extracts a user-friendly error message from an unknown error value.
 *
 * Handles multiple error types with comprehensive type checking:
 * - Standard Error objects
 * - Network/Fetch errors (TypeError)
 * - API error responses (with response.data.error)
 * - Plain string errors
 * - Objects with message property
 * - Zod validation errors
 * - Unknown error types
 *
 * @param error - The error value (can be Error, string, or unknown)
 * @param fallback - Fallback message if error cannot be converted to string
 * @returns A string error message
 *
 * @example
 * ```ts
 * try {
 *   await someAsyncOperation();
 * } catch (error) {
 *   const message = getErrorMessage(error);
 *   toast.error('Operation failed', { description: message });
 * }
 * ```
 */
export function getErrorMessage(
  error: unknown,
  fallback = "An unexpected error occurred"
): string {
  // Handle standard Error objects
  if (isError(error)) {
    return error.message;
  }

  // Handle network/fetch errors
  if (isFetchError(error)) {
    return "Network error. Please check your connection and try again.";
  }

  // Handle API error responses
  if (isApiError(error)) {
    const apiError =
      error.response?.data?.error || error.response?.data?.message;
    if (typeof apiError === "string") {
      return apiError;
    }
  }

  // Handle plain strings
  if (typeof error === "string") {
    return error;
  }

  // Handle objects with message property
  if (isErrorWithMessage(error)) {
    return String(error.message);
  }

  // Handle null/undefined
  if (error === null || error === undefined) {
    return fallback;
  }

  // Last resort: try to stringify the error
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}
