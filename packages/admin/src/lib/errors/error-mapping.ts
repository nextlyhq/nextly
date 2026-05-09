/**
 * Server Error to Form Field Mapping Utilities
 *
 * Parses canonical-shape server validation errors and maps them to React Hook
 * Form fields. Enables inline error display when the server returns validation
 * errors.
 *
 * ## API Error Format
 * Per spec §10.1, the server returns errors as:
 * ```json
 * {
 *   "error": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Validation failed.",
 *     "data": {
 *       "errors": [
 *         { "path": "email", "code": "INVALID_FORMAT", "message": "Must be a valid email address." },
 *         { "path": "links[0].url", "code": "REQUIRED", "message": "URL is required." }
 *       ]
 *     },
 *     "requestId": "req_..."
 *   }
 * }
 * ```
 *
 * @module lib/error-mapping
 */

import type { UseFormSetError, FieldPath, FieldValues } from "react-hook-form";

// ============================================================================
// Types
// ============================================================================

/**
 * Individual field error from server response (canonical wire shape per spec §7.2).
 */
export interface ServerFieldError {
  /** Dotted/bracketed field path: "user.email", "items[2].quantity" */
  path: string;
  /** Stable error code: "INVALID_FORMAT", "REQUIRED", "TOO_LOW", ... */
  code: string;
  /** Human-readable sentence */
  message: string;
}

/**
 * Server error response (canonical wire shape per spec §10.1).
 */
export interface ServerErrorResponse {
  error: {
    code: string;
    message: string;
    data?: {
      errors?: ServerFieldError[];
      [key: string]: unknown;
    };
    requestId?: string;
  };
}

/**
 * Options for mapping server errors to form
 */
export interface MapServerErrorsOptions {
  /** Whether to scroll to the first error field (default: true) */
  scrollToError?: boolean;
  /** Whether to focus the first error field (default: true) */
  focusFirst?: boolean;
  /** Delay in ms before focusing (allows scroll to complete) */
  focusDelay?: number;
}

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Extract field-level errors from a canonical wire-shape error response.
 *
 * Reads `error.data.errors[]` only. Returns `null` when the input is not a
 * canonical error response or has no field-level errors.
 *
 * Also accepts a fetch/axios-style wrapper where the body is nested under
 * `.response.data` so `parseServerErrors(thrownError)` works without the
 * caller having to unwrap the response object.
 */
export function parseServerErrors(
  response: unknown
): ServerFieldError[] | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const resp = response as Record<string, unknown>;

  if (
    "response" in resp &&
    typeof resp.response === "object" &&
    resp.response !== null
  ) {
    const axiosResp = resp.response as Record<string, unknown>;
    if ("data" in axiosResp) {
      return parseServerErrors(axiosResp.data);
    }
  }

  if (
    "error" in resp &&
    typeof resp.error === "object" &&
    resp.error !== null
  ) {
    const errorObj = resp.error as Record<string, unknown>;
    if (
      "data" in errorObj &&
      typeof errorObj.data === "object" &&
      errorObj.data !== null
    ) {
      const data = errorObj.data as Record<string, unknown>;
      if (Array.isArray(data.errors)) {
        return data.errors.filter(
          (e): e is ServerFieldError =>
            typeof e === "object" &&
            e !== null &&
            "path" in e &&
            "code" in e &&
            "message" in e &&
            typeof (e as ServerFieldError).path === "string" &&
            typeof (e as ServerFieldError).code === "string" &&
            typeof (e as ServerFieldError).message === "string"
        );
      }
    }
  }

  return null;
}

/**
 * Extract the general error message from server response
 *
 * @param response - API response or error object
 * @returns Error message string or null
 */
export function parseServerErrorMessage(response: unknown): string | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const resp = response as Record<string, unknown>;

  // Handle axios/fetch error wrapper
  if ("response" in resp && typeof resp.response === "object") {
    const axiosResp = resp.response as Record<string, unknown>;
    if ("data" in axiosResp) {
      return parseServerErrorMessage(axiosResp.data);
    }
  }

  // Standard format: { error: { message: "..." } }
  if ("error" in resp && typeof resp.error === "object") {
    const errorObj = resp.error as Record<string, unknown>;
    if (typeof errorObj.message === "string") {
      return errorObj.message;
    }
  }

  // Direct message: { message: "..." }
  if (typeof resp.message === "string") {
    return resp.message;
  }

  // Error instance
  if (resp instanceof Error) {
    return resp.message;
  }

  return null;
}

// ============================================================================
// Form Integration Functions
// ============================================================================

/**
 * Map server errors to React Hook Form fields
 *
 * Sets errors on form fields using `setError` from React Hook Form.
 * Optionally scrolls to and focuses the first error field.
 *
 * @param errors - Array of field errors from server
 * @param setError - React Hook Form setError function
 * @param options - Mapping options (scroll, focus)
 *
 * @example
 * ```typescript
 * const serverErrors = parseServerErrors(apiResponse);
 * if (serverErrors) {
 *   mapServerErrorsToForm(serverErrors, form.setError, {
 *     scrollToError: true,
 *     focusFirst: true,
 *   });
 * }
 * ```
 */
export function mapServerErrorsToForm<T extends FieldValues>(
  errors: ServerFieldError[],
  setError: UseFormSetError<T>,
  options: MapServerErrorsOptions = {}
): void {
  const { scrollToError = true, focusFirst = true, focusDelay = 300 } = options;

  let firstErrorField: string | null = null;

  for (const error of errors) {
    const fieldPath = error.path as FieldPath<T>;

    // Set error on form field
    setError(fieldPath, {
      type: "server",
      message: error.message,
    });

    if (!firstErrorField) {
      firstErrorField = error.path;
    }
  }

  // Scroll to and focus first error field
  if (firstErrorField && (scrollToError || focusFirst)) {
    // Try multiple selectors to find the field element. The path may include
    // bracket notation for arrays ("items[2].quantity") so the id-selector
    // strips both dots and brackets.
    const selectors = [
      `[name="${firstErrorField}"]`,
      `#field-${firstErrorField.replace(/[.[\]]/g, "-")}`,
      `[data-field="${firstErrorField}"]`,
    ];

    let fieldElement: Element | null = null;
    for (const selector of selectors) {
      fieldElement = document.querySelector(selector);
      if (fieldElement) break;
    }

    if (fieldElement) {
      if (scrollToError) {
        fieldElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      if (focusFirst && "focus" in fieldElement) {
        setTimeout(() => (fieldElement as HTMLElement).focus(), focusDelay);
      }
    }
  }
}

/**
 * Create an error handler for mutation hooks
 *
 * Returns a function that parses server errors and maps them to form fields.
 * Returns `true` if errors were handled (mapped to form), `false` otherwise.
 *
 * @param setError - React Hook Form setError function
 * @param options - Mapping options
 * @returns Error handler function
 *
 * @example
 * ```typescript
 * const handleServerError = createServerErrorHandler(form.setError);
 *
 * useMutation({
 *   onError: (error) => {
 *     const handled = handleServerError(error);
 *     if (!handled) {
 *       toast.error("An unexpected error occurred");
 *     }
 *   },
 * });
 * ```
 */
export function createServerErrorHandler<T extends FieldValues>(
  setError: UseFormSetError<T>,
  options?: MapServerErrorsOptions
) {
  return (error: unknown): boolean => {
    const serverErrors = parseServerErrors(error);

    if (serverErrors && serverErrors.length > 0) {
      mapServerErrorsToForm(serverErrors, setError, options);
      return true; // Errors were handled
    }

    return false; // No field-level errors found
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if an error response contains field-level validation errors
 *
 * @param error - Error response to check
 * @returns True if field errors exist
 */
export function hasFieldErrors(error: unknown): boolean {
  const errors = parseServerErrors(error);
  return errors !== null && errors.length > 0;
}

/**
 * Format a field path for display
 *
 * Converts dot notation paths to human-readable format:
 * - "title" → "Title"
 * - "links.0.url" → "Links → Item 1 → Url"
 * - "metadata.seo.description" → "Metadata → Seo → Description"
 *
 * @param path - Field path in dot notation
 * @returns Human-readable field name
 */
export function formatFieldPath(path: string): string {
  return path
    .split(".")
    .map(part => {
      // Handle array indices
      if (/^\d+$/.test(part)) {
        return `Item ${parseInt(part, 10) + 1}`;
      }
      // Capitalize first letter, handle camelCase
      return part
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, str => str.toUpperCase())
        .trim();
    })
    .join(" → ");
}

/**
 * Scroll to a form field by its path
 *
 * @param path - Field path in dot notation
 */
export function scrollToField(path: string): void {
  const selectors = [
    `[name="${path}"]`,
    `#field-${path.replace(/\./g, "-")}`,
    `[data-field="${path}"]`,
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      if ("focus" in element) {
        setTimeout(() => (element as HTMLElement).focus(), 300);
      }
      break;
    }
  }
}
