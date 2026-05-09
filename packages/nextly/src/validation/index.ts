/**
 * Validation Module
 *
 * Provides standardized validation error types and utilities
 * for consistent error handling across the Nextly system.
 *
 * @module validation
 */

// Types
export type {
  ValidationErrorCode,
  ValidationError,
  ValidationResult,
  ValidationErrorResponse,
} from "./types";

// Constants
export { VALIDATION_ERROR_CODES } from "./types";

// Type Guards
export {
  isValidationErrorCode,
  isValidationError,
  isValidationResult,
} from "./types";

// Factory Functions
export {
  createValidationError,
  validResult,
  invalidResult,
  createValidationErrorResponse,
} from "./types";

// Error Formatting Utilities
export {
  formatZodError,
  mergeValidationResults,
  toApiResponse,
} from "./error-formatter";
