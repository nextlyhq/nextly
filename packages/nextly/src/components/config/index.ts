/**
 * Component Configuration - Public Exports
 *
 * Re-exports all component configuration types, helpers, and validation
 * functions for external consumption.
 *
 * @module components/config
 * @since 1.0.0
 */

// ============================================================
// Configuration Types
// ============================================================

export type {
  ComponentConfig,
  ComponentLabel,
  ComponentAdminOptions,
} from "./types";

// ============================================================
// Define Helper
// ============================================================

export { defineComponent } from "./define-component";

// ============================================================
// Validation
// ============================================================

export {
  validateComponentConfig,
  assertValidComponentConfig,
  RESERVED_COMPONENT_SLUGS,
  MAX_COMPONENT_NESTING_DEPTH,
} from "./validate-component";

export type {
  ComponentValidationErrorCode,
  ComponentValidationError,
  ComponentValidationResult,
} from "./validate-component";
