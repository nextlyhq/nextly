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

import {
  isApiError,
  normalizeValidationIssues,
  validationIssues,
  type ValidationIssue,
} from "../api/parseApiError";

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
 * Every issue a rejection or an error body carries, read once.
 *
 * Three shapes reach a form: the `ApiError` the fetcher THROWS, which carries
 * the body's `data` on the error itself; a raw `{ error: { data } }` body; and
 * a fetch/axios-style wrapper holding that body under `.response.data`. The
 * thrown one is the shape every entry save meets, and reading only the other
 * two is how a refused save's field reason never reached its field.
 *
 * `null` where the value is none of them, or carries no `errors` list.
 */
function issuesOf(response: unknown): readonly ValidationIssue[] | null {
  // The thrown error first: it is also an object with a `message`, and only
  // its `data` says what the server refused.
  if (isApiError(response)) {
    return Array.isArray(response.data?.errors)
      ? validationIssues(response)
      : null;
  }
  if (!isRecord(response)) return null;
  // A fetch/axios-style wrapper: the body under `.response.data`.
  if (isRecord(response.response) && "data" in response.response) {
    return issuesOf(response.response.data);
  }
  const errors =
    isRecord(response.error) && isRecord(response.error.data)
      ? response.error.data.errors
      : undefined;
  // Normalized once, in `parseApiError`'s module, then NARROWED by each
  // caller. Traversing `data.errors` a second time would be a second answer
  // to what the wire carries, and the two drifted the moment they existed.
  return Array.isArray(errors) ? normalizeValidationIssues(errors) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** An issue that can name a form control: a path, a code and a message. */
function namesAField(issue: ValidationIssue): issue is ServerFieldError {
  return (
    issue.path !== undefined &&
    issue.code !== undefined &&
    issue.message !== undefined
  );
}

/**
 * Extract field-level errors from a server rejection: the `ApiError` the
 * fetcher throws, a canonical wire-shape body, or a fetch/axios-style wrapper
 * around one (`.response.data`), so `parseServerErrors(thrownError)` works
 * without the caller unwrapping anything.
 *
 * Reads `data.errors[]` only, and keeps an issue only when it carries all
 * three of path, code and message: this view names a form control with them,
 * a stricter requirement than a consumer showing a sentence has. Returns
 * `null` when the input carries no `errors` list at all.
 */
export function parseServerErrors(
  response: unknown
): ServerFieldError[] | null {
  const issues = issuesOf(response);
  return issues === null ? null : issues.filter(namesAField);
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

/** Options for {@link applyServerFieldErrors}. */
export interface ApplyServerFieldErrorsOptions extends MapServerErrorsOptions {
  /**
   * Whether the form draws a field at this path. An error set on a path the
   * form does not draw is kept by the form and shown nowhere, so its reason is
   * handed back instead, for the caller to say some other way. Every path, if
   * absent.
   */
  isFormField?: ((path: string) => boolean) | undefined;
}

/** What {@link applyServerFieldErrors} did with a rejection's reasons. */
export interface AppliedServerFieldErrors {
  /** How many reasons were put on a field. */
  mapped: number;
  /**
   * The reasons no field on the form can show: an issue with no path, or one
   * whose path the form does not draw. In the order the server gave them.
   */
  unplaced: string[];
}

/**
 * Put a rejection's field reasons on the form's fields, and hand back the
 * ones no field can show.
 *
 * The form keeps the author's values: this only sets errors. A reason whose
 * field the form does not draw (a `status` refused on unpublish, a rule
 * about the whole document) is returned rather than set, because an error on
 * an undrawn path is stored and never seen.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  options: ApplyServerFieldErrorsOptions = {}
): AppliedServerFieldErrors {
  const { isFormField = () => true, ...mapOptions } = options;
  const placed: ServerFieldError[] = [];
  const unplaced: string[] = [];
  for (const issue of issuesOf(error) ?? []) {
    if (namesAField(issue) && isFormField(issue.path)) placed.push(issue);
    else if (issue.message !== undefined) unplaced.push(issue.message);
  }
  if (placed.length > 0) mapServerErrorsToForm(placed, setError, mapOptions);
  return { mapped: placed.length, unplaced };
}

/**
 * Whether a server path names a field among `fieldNames`: the path's first
 * step (`title` in `title.en` or `items[2].url`) is one of them.
 */
export function pathOnForm(
  fieldNames: ReadonlySet<string>
): (path: string) => boolean {
  return path => fieldNames.has(path.split(/[.[]/, 1)[0] ?? "");
}

/**
 * What an entry save's failure handler does with a refusal: its field reasons
 * on the form, and what the toast says.
 *
 * `handled` is true when every reason is on a field the form draws, so the
 * form says all of it and no toast repeats it. Otherwise `toastMessage` holds
 * the reasons no field can show, for the toast to say in place of the
 * envelope's bare "Validation failed."; it is undefined when the refusal
 * carried none, and the caller's own message stands.
 */
export function placeServerRefusal<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T> | undefined,
  options?: ApplyServerFieldErrorsOptions
): { handled: boolean; toastMessage: string | undefined } {
  if (setError === undefined) {
    return { handled: false, toastMessage: undefined };
  }
  const { mapped, unplaced } = applyServerFieldErrors(error, setError, options);
  return {
    handled: mapped > 0 && unplaced.length === 0,
    toastMessage: unplaced.length > 0 ? unplaced.join(" ") : undefined,
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
