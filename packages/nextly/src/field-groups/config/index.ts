/**
 * Component Configuration - Public Exports
 *
 * Re-exports all component configuration types, helpers, and validation
 * functions for external consumption.
 *
 * @module field-groups/config
 * @since 1.0.0
 */

// ============================================================
// Configuration Types
// ============================================================

export type {
  FieldGroupConfig,
  FieldGroupLabel,
  FieldGroupAdminOptions,
} from "./types";

// ============================================================
// Define Helper
// ============================================================

export { defineFieldGroup } from "./define-field-group";

// ============================================================
// Validation
// ============================================================

export {
  validateFieldGroupConfig,
  assertValidFieldGroupConfig,
  RESERVED_FIELD_GROUP_SLUGS,
  MAX_FIELD_GROUP_NESTING_DEPTH,
} from "./validate-field-group";

export type {
  FieldGroupValidationErrorCode,
  FieldGroupValidationError,
  FieldGroupValidationResult,
} from "./validate-field-group";
