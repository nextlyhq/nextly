/**
 * Error Formatter Utilities
 *
 * Provides utilities for converting Zod validation errors to our
 * standardized validation error format and merging validation results.
 *
 * @module validation/error-formatter
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { formatZodError, mergeValidationResults, toApiResponse } from "@revnixhq/nextly/validation";
 *
 * const schema = z.object({
 *   email: z.string().email(),
 *   age: z.number().min(18),
 * });
 *
 * const result = schema.safeParse({ email: "invalid", age: 15 });
 * if (!result.success) {
 *   const validationResult = formatZodError(result.error);
 *   const apiResponse = toApiResponse(validationResult);
 *   return NextResponse.json(apiResponse, { status: 400 });
 * }
 * ```
 */

import type { z } from "zod";

import type {
  ValidationError,
  ValidationErrorCode,
  ValidationResult,
  ValidationErrorResponse,
} from "./types";

// ============================================================
// Zod v4 Issue Code Type
// ============================================================

/**
 * Zod v4 issue codes.
 * These are the codes used in Zod v4's ZodIssue.code property.
 * @internal
 */
type ZodV4IssueCode =
  | "invalid_type"
  | "too_big"
  | "too_small"
  | "invalid_format"
  | "not_multiple_of"
  | "unrecognized_keys"
  | "invalid_union"
  | "invalid_key"
  | "invalid_element"
  | "invalid_value"
  | "custom";

/**
 * Generic Zod issue shape for v4 compatibility.
 * @internal
 */
interface ZodIssueBase {
  code: string;
  path: (string | number)[];
  message: string;
  // Additional properties vary by issue type
  [key: string]: unknown;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Safely get a string property from an object.
 * @internal
 */
function getStringProp(obj: unknown, key: string): string | undefined {
  if (typeof obj === "object" && obj !== null && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

// ============================================================
// Code Mapping
// ============================================================

/**
 * Map Zod v4 issue code to our ValidationErrorCode.
 *
 * This function performs smart mapping based on:
 * - The Zod issue code
 * - Issue metadata (origin, format, etc.)
 *
 * @param issue - The Zod issue to map
 * @returns The appropriate ValidationErrorCode
 *
 * @internal
 */
function mapZodCodeToValidationCode(issue: ZodIssueBase): ValidationErrorCode {
  const code = issue.code as ZodV4IssueCode;

  switch (code) {
    // Type mismatch
    case "invalid_type":
      return "invalid_type";

    // Size constraints - map based on the origin (type of value)
    case "too_small": {
      const origin = getStringProp(issue, "origin");
      switch (origin) {
        case "string":
          return "min_length";
        case "number":
        case "bigint":
          return "min_value";
        case "repeater":
        case "set":
          return "min_items";
        case "date":
          return "invalid_date";
        default:
          return "too_small";
      }
    }

    case "too_big": {
      const origin = getStringProp(issue, "origin");
      switch (origin) {
        case "string":
          return "max_length";
        case "number":
        case "bigint":
          return "max_value";
        case "repeater":
        case "set":
          return "max_items";
        case "date":
          return "invalid_date";
        default:
          return "too_big";
      }
    }

    // String format validation - map based on the format type
    case "invalid_format": {
      const format = getStringProp(issue, "format");
      switch (format) {
        case "email":
          return "invalid_email";
        case "url":
          return "invalid_url";
        case "uuid":
          return "invalid_uuid";
        case "regex":
          return "pattern";
        case "datetime":
        case "date":
        case "time":
          return "invalid_date";
        default:
          return "invalid_format";
      }
    }

    // Invalid value (merged from literal and enum in v4)
    case "invalid_value":
      return "invalid_option";

    // Union validation
    case "invalid_union":
      return "type_error";

    // Object validation
    case "unrecognized_keys":
      return "unknown_key";

    // Number validation
    case "not_multiple_of":
      return "custom";

    // Record/Map key validation
    case "invalid_key":
      return "custom";

    // Map/Set element validation
    case "invalid_element":
      return "custom";

    // Custom validation
    case "custom":
      return "custom";

    // Fallback for any unknown codes
    default:
      return "custom";
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Convert a Zod error to our standardized ValidationResult format.
 *
 * This function transforms Zod's native error format into our
 * consistent validation error structure, enabling unified error
 * handling across the application.
 *
 * @param error - The ZodError to convert
 * @returns ValidationResult with valid=false and mapped errors
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { formatZodError } from "@revnixhq/nextly/validation";
 *
 * const schema = z.object({
 *   email: z.string().email(),
 *   age: z.number().min(18),
 * });
 *
 * const result = schema.safeParse({ email: "bad", age: 10 });
 * if (!result.success) {
 *   const validationResult = formatZodError(result.error);
 *   // {
 *   //   valid: false,
 *   //   errors: [
 *   //     { path: "email", code: "invalid_email", message: "Invalid email" },
 *   //     { path: "age", code: "min_value", message: "Number must be >= 18" }
 *   //   ]
 *   // }
 * }
 * ```
 */
export function formatZodError(error: z.ZodError): ValidationResult {
  return {
    valid: false,
    errors: error.issues.map(
      (issue): ValidationError => ({
        path: issue.path.join("."),
        message: issue.message,
        code: mapZodCodeToValidationCode(issue as ZodIssueBase),
        // Note: value is intentionally omitted for security reasons
        // Zod v4 has 'input' on issues but we don't expose it
      })
    ),
  };
}

/**
 * Merge multiple validation results into a single result.
 *
 * This is useful when you need to combine validation from
 * multiple sources (e.g., Zod schema + custom business rules).
 *
 * @param results - The validation results to merge
 * @returns A single ValidationResult containing all errors
 *
 * @example
 * ```typescript
 * import { formatZodError, mergeValidationResults, invalidResult } from "@revnixhq/nextly/validation";
 *
 * // Schema validation
 * const schemaResult = formatZodError(zodError);
 *
 * // Custom business rule validation
 * const businessResult = invalidResult([
 *   { path: "email", code: "unique", message: "Email already exists" }
 * ]);
 *
 * // Combine all errors
 * const finalResult = mergeValidationResults(schemaResult, businessResult);
 * ```
 */
export function mergeValidationResults(
  ...results: ValidationResult[]
): ValidationResult {
  const errors = results.flatMap(r => r.errors);
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format a validation result for API response.
 *
 * Converts a ValidationResult into the standard API error response
 * format with a fixed message including the error count.
 *
 * @param result - The validation result to format
 * @returns ValidationErrorResponse suitable for API response
 *
 * @example
 * ```typescript
 * import { formatZodError, toApiResponse } from "@revnixhq/nextly/validation";
 * import { NextResponse } from "next/server";
 *
 * const result = schema.safeParse(data);
 * if (!result.success) {
 *   const validationResult = formatZodError(result.error);
 *   const apiResponse = toApiResponse(validationResult);
 *   return NextResponse.json(apiResponse, { status: 400 });
 * }
 *
 * // Response:
 * // {
 * //   "error": {
 * //     "code": "VALIDATION_ERROR",
 * //     "message": "Validation failed with 2 error(s)",
 * //     "details": [...]
 * //   }
 * // }
 * ```
 */
export function toApiResponse(
  result: ValidationResult
): ValidationErrorResponse {
  return {
    error: {
      code: "VALIDATION_ERROR",
      message: `Validation failed with ${result.errors.length} error(s)`,
      details: result.errors,
    },
  };
}
