/**
 * Validation Error Types
 *
 * Standardized validation error types for consistent error handling
 * across the Nextly system. Compatible with Zod error transformation.
 *
 * @module validation/types
 */

// ============================================================
// Validation Error Codes
// ============================================================

/**
 * Standard validation error codes.
 *
 * These codes provide programmatic error identification and
 * enable type-safe error handling.
 *
 * @example
 * ```typescript
 * if (error.code === 'required') {
 *   // Handle required field error
 * }
 * ```
 */
export type ValidationErrorCode =
  // Required/Missing
  | "required"

  // Type errors
  | "type_error"
  | "invalid_type"

  // String constraints
  | "min_length"
  | "max_length"
  | "too_short"
  | "too_long"
  | "pattern"

  // Numeric constraints
  | "min_value"
  | "max_value"
  | "too_small"
  | "too_big"
  | "not_integer"
  | "not_finite"

  // Format validation
  | "invalid_email"
  | "invalid_url"
  | "invalid_uuid"
  | "invalid_date"
  | "invalid_format"

  // Selection/Reference
  | "invalid_option"
  | "invalid_reference"
  | "invalid_enum"

  // Uniqueness
  | "unique"
  | "duplicate"

  // Array constraints
  | "min_items"
  | "max_items"
  | "invalid_array"

  // Object constraints
  | "invalid_object"
  | "unknown_key"

  // File/Upload
  | "invalid_file_type"
  | "file_too_large"

  // Custom validation
  | "custom";

/**
 * All validation error codes as a const array.
 * Useful for runtime validation and iteration.
 */
export const VALIDATION_ERROR_CODES = [
  "required",
  "type_error",
  "invalid_type",
  "min_length",
  "max_length",
  "too_short",
  "too_long",
  "pattern",
  "min_value",
  "max_value",
  "too_small",
  "too_big",
  "not_integer",
  "not_finite",
  "invalid_email",
  "invalid_url",
  "invalid_uuid",
  "invalid_date",
  "invalid_format",
  "invalid_option",
  "invalid_reference",
  "invalid_enum",
  "unique",
  "duplicate",
  "min_items",
  "max_items",
  "invalid_array",
  "invalid_object",
  "unknown_key",
  "invalid_file_type",
  "file_too_large",
  "custom",
] as const;

// ============================================================
// Validation Error Types
// ============================================================

/**
 * Individual validation error.
 *
 * Represents a single validation failure with its location,
 * error code, human-readable message, and optionally the
 * invalid value.
 *
 * @example
 * ```typescript
 * const error: ValidationError = {
 *   path: 'user.email',
 *   code: 'invalid_email',
 *   message: 'Invalid email format',
 *   value: 'not-an-email',
 * };
 * ```
 */
export interface ValidationError {
  /**
   * Dot-notation path to the invalid field.
   * For nested fields: "fields.0.options.1.label"
   * For root fields: "email"
   */
  path: string;

  /**
   * Human-readable error message.
   * Should be suitable for display to end users.
   */
  message: string;

  /**
   * Typed error code for programmatic handling.
   */
  code: ValidationErrorCode;

  /**
   * The invalid value that caused the error.
   * Optional - may be omitted for security reasons.
   */
  value?: unknown;
}

/**
 * Result of a validation operation.
 *
 * @example
 * ```typescript
 * function validateUser(data: unknown): ValidationResult {
 *   const errors: ValidationError[] = [];
 *
 *   if (!data.email) {
 *     errors.push({
 *       path: 'email',
 *       code: 'required',
 *       message: 'Email is required',
 *     });
 *   }
 *
 *   return {
 *     valid: errors.length === 0,
 *     errors,
 *   };
 * }
 * ```
 */
export interface ValidationResult {
  /**
   * Whether the validation passed (no errors).
   */
  valid: boolean;

  /**
   * Array of validation errors.
   * Empty array when valid is true.
   */
  errors: ValidationError[];
}

// ============================================================
// API Response Types
// ============================================================

/**
 * Standard API response format for validation errors.
 *
 * Used for HTTP 400 responses when input validation fails.
 *
 * @example
 * ```typescript
 * // API Response
 * {
 *   "error": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Validation failed",
 *     "details": [
 *       {
 *         "path": "email",
 *         "code": "invalid_email",
 *         "message": "Invalid email format"
 *       }
 *     ]
 *   }
 * }
 * ```
 */
export interface ValidationErrorResponse {
  error: {
    /**
     * Always "VALIDATION_ERROR" for validation errors.
     */
    code: "VALIDATION_ERROR";

    /**
     * Summary message describing the error.
     */
    message: string;

    /**
     * Array of individual field validation errors.
     */
    details: ValidationError[];
  };
}

// ============================================================
// Type Guards
// ============================================================

/**
 * Check if a string is a valid ValidationErrorCode.
 *
 * @param code - The string to check
 * @returns True if the code is a valid ValidationErrorCode
 *
 * @example
 * ```typescript
 * if (isValidationErrorCode('required')) {
 *   // TypeScript knows this is ValidationErrorCode
 * }
 * ```
 */
export function isValidationErrorCode(
  code: string
): code is ValidationErrorCode {
  return VALIDATION_ERROR_CODES.includes(code as ValidationErrorCode);
}

/**
 * Check if an object is a ValidationError.
 *
 * @param obj - The object to check
 * @returns True if the object is a ValidationError
 *
 * @example
 * ```typescript
 * if (isValidationError(err)) {
 *   console.log(err.path, err.message);
 * }
 * ```
 */
export function isValidationError(obj: unknown): obj is ValidationError {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  const error = obj as Record<string, unknown>;

  return (
    typeof error.path === "string" &&
    typeof error.message === "string" &&
    typeof error.code === "string" &&
    isValidationErrorCode(error.code)
  );
}

/**
 * Check if an object is a ValidationResult.
 *
 * @param obj - The object to check
 * @returns True if the object is a ValidationResult
 */
export function isValidationResult(obj: unknown): obj is ValidationResult {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  const result = obj as Record<string, unknown>;

  return (
    typeof result.valid === "boolean" &&
    Array.isArray(result.errors) &&
    result.errors.every(isValidationError)
  );
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * Create a validation error.
 *
 * @param path - Dot-notation path to the field
 * @param code - Error code
 * @param message - Human-readable message
 * @param value - Optional invalid value
 * @returns ValidationError object
 *
 * @example
 * ```typescript
 * const error = createValidationError(
 *   'user.email',
 *   'invalid_email',
 *   'Please enter a valid email address'
 * );
 * ```
 */
export function createValidationError(
  path: string,
  code: ValidationErrorCode,
  message: string,
  value?: unknown
): ValidationError {
  const error: ValidationError = {
    path,
    code,
    message,
  };

  if (value !== undefined) {
    error.value = value;
  }

  return error;
}

/**
 * Create a successful validation result.
 *
 * @returns ValidationResult with valid=true and empty errors
 */
export function validResult(): ValidationResult {
  return {
    valid: true,
    errors: [],
  };
}

/**
 * Create a failed validation result.
 *
 * @param errors - Array of validation errors
 * @returns ValidationResult with valid=false and the errors
 */
export function invalidResult(errors: ValidationError[]): ValidationResult {
  return {
    valid: false,
    errors,
  };
}

/**
 * Create a validation error response for API.
 *
 * @param errors - Array of validation errors
 * @param message - Optional summary message
 * @returns ValidationErrorResponse object
 *
 * @example
 * ```typescript
 * const response = createValidationErrorResponse(errors);
 * return NextResponse.json(response, { status: 400 });
 * ```
 */
export function createValidationErrorResponse(
  errors: ValidationError[],
  message: string = "Validation failed"
): ValidationErrorResponse {
  return {
    error: {
      code: "VALIDATION_ERROR",
      message,
      details: errors,
    },
  };
}
