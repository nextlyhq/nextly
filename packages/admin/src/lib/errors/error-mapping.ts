/**
 * Server Error to Form Field Mapping Utilities
 *
 * Utilities for parsing server-side validation errors and mapping them
 * to React Hook Form fields. Enables inline error display on form fields
 * when the server returns validation errors.
 *
 * ## API Error Format
 * The server returns errors in this format:
 * ```json
 * {
 *   "success": false,
 *   "statusCode": 400,
 *   "error": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Validation failed",
 *     "details": {
 *       "errors": [
 *         { "field": "email", "message": "Invalid email format" },
 *         { "field": "links.0.url", "message": "URL is required" }
 *       ]
 *     }
 *   }
 * }
 * ```
 *
 * @module lib/error-mapping
 * @since 1.0.0
 */

import type { UseFormSetError, FieldPath, FieldValues } from "react-hook-form";

// ============================================================================
// Types
// ============================================================================

/**
 * Individual field error from server response
 */
export interface ServerFieldError {
  /** Field path (supports dot notation for nested fields, e.g., "links.0.url") */
  field: string;
  /** Error message to display */
  message: string;
  /** Optional error code for programmatic handling */
  code?: string;
}

/**
 * Server error response format (matches ApiErrorResponse from nextly/api/error-handler)
 */
export interface ServerErrorResponse {
  success: false;
  statusCode: number;
  error: {
    code: string;
    message: string;
    details?: {
      errors?: ServerFieldError[];
      [key: string]: unknown;
    };
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
 * Parse API response and extract field-level errors
 *
 * Handles multiple error response formats:
 * 1. Standard format: `error.details.errors[]`
 * 2. Legacy format: `validationErrors` object
 * 3. Axios error format: `response.data.error.details.errors[]`
 *
 * @param response - API response or error object
 * @returns Array of field errors, or null if none found
 *
 * @example
 * ```typescript
 * const errors = parseServerErrors(apiResponse);
 * if (errors) {
 *   errors.forEach(e => console.log(`${e.field}: ${e.message}`));
 * }
 * ```
 */
export function parseServerErrors(
  response: unknown
): ServerFieldError[] | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const resp = response as Record<string, unknown>;

  // Handle axios/fetch error wrapper (error.response.data)
  if ("response" in resp && typeof resp.response === "object") {
    const axiosResp = resp.response as Record<string, unknown>;
    if ("data" in axiosResp) {
      return parseServerErrors(axiosResp.data);
    }
  }

  // Standard API error format: { success: false, error: { details: { errors: [] } } }
  if ("error" in resp && typeof resp.error === "object") {
    const errorObj = resp.error as Record<string, unknown>;
    if ("details" in errorObj && typeof errorObj.details === "object") {
      const details = errorObj.details as Record<string, unknown>;
      if (Array.isArray(details.errors)) {
        return details.errors.filter(
          (e): e is ServerFieldError =>
            typeof e === "object" &&
            e !== null &&
            "field" in e &&
            "message" in e &&
            typeof e.field === "string" &&
            typeof e.message === "string"
        );
      }
    }
  }

  // Legacy format: { validationErrors: { field: message } }
  if ("validationErrors" in resp && typeof resp.validationErrors === "object") {
    const validationErrors = resp.validationErrors as Record<string, unknown>;
    return Object.entries(validationErrors).map(([field, message]) => ({
      field,
      message: String(message),
    }));
  }

  // Direct errors array format: { errors: [] }
  if (Array.isArray(resp.errors)) {
    return resp.errors.filter(
      (e): e is ServerFieldError =>
        typeof e === "object" &&
        e !== null &&
        "field" in e &&
        "message" in e &&
        typeof e.field === "string" &&
        typeof e.message === "string"
    );
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
    const fieldPath = error.field as FieldPath<T>;

    // Set error on form field
    setError(fieldPath, {
      type: "server",
      message: error.message,
    });

    if (!firstErrorField) {
      firstErrorField = error.field;
    }
  }

  // Scroll to and focus first error field
  if (firstErrorField && (scrollToError || focusFirst)) {
    // Try multiple selectors to find the field element
    const selectors = [
      `[name="${firstErrorField}"]`,
      `#field-${firstErrorField.replace(/\./g, "-")}`,
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
