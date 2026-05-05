/**
 * Single Config - Public Exports
 *
 * Re-exports all Single configuration types and functions.
 * Singles are single-document entities for storing
 * site-wide configuration such as site settings, navigation menus, and footers.
 *
 * @module singles/config
 * @since 1.0.0
 */

export {
  // Main function
  defineSingle,
  // Config interfaces (re-exported from define-single for convenience)
  type SingleConfig,
  type SingleLabel,
  type SingleAdminOptions,
  type SingleAccessControl,
  type SingleHooks,
} from "./define-single";

export {
  // Validation functions
  validateSingleConfig,
  assertValidSingleConfig,
  // Validation types
  type SingleValidationResult,
  type SingleValidationError,
  type SingleValidationErrorCode,
  // Constants (for advanced usage)
  RESERVED_SINGLE_SLUGS,
  RESERVED_SLUGS,
  SQL_RESERVED_KEYWORDS,
} from "./validate-single";

// RBAC Access Control Types (Plan 13)
// These types are used with defineSingle({ access }) for code-defined
// access control functions that integrate with the RBAC system.
// Note: SingleAccessControl is already exported from define-single above.
export {
  type AccessControlContext,
  type AccessControlFunction,
  type MinimalUser,
} from "../../services/auth/access-control-types";
