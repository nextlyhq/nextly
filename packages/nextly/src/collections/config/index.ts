/**
 * Collection Config - Public Exports
 *
 * Re-exports all collection configuration types and functions.
 *
 * @module collections/config
 * @since 1.0.0
 */

export {
  // Main function
  defineCollection,
  // Config interfaces
  type CollectionConfig,
  type CollectionLabels,
  type CollectionAdminOptions,
  type CollectionPagination,
  type CollectionPreviewConfig,
  type CollectionAccessControl,
  type CollectionHooks,
  type CustomEndpoint,
  type HttpMethod,
  type IndexConfig,
  type SearchConfig,
  // Re-exported types
  type FieldConfig,
  type HookHandler,
} from "./define-collection";

export {
  // Validation functions
  validateCollectionConfig,
  assertValidCollectionConfig,
  // Validation types
  type ValidationError,
  type ValidationResult,
  type ValidationErrorCode,
  // Constants (for advanced usage)
  RESERVED_SLUGS,
  SQL_RESERVED_KEYWORDS,
} from "./validate-config";

export {
  // Main function
  defineConfig,
  // Config interfaces
  type NextlyConfig,
  type SanitizedNextlyConfig,
  type TypeScriptConfig,
  type DatabaseConfig,
  type RateLimitingConfig,
  type SanitizedRateLimitingConfig,
  type SecurityConfig,
  type AdminConfig,
  type AdminBrandingConfig,
  type AdminBrandingColors,
  type PluginOverride,
} from "./define-config";

// RBAC Access Control Types (Plan 13)
// These types are used with defineCollection({ access }) and defineSingle({ access })
// for code-defined access control functions that integrate with the RBAC system.
// Note: CollectionAccessControl is already exported from define-collection above.
export {
  type AccessControlContext,
  type AccessControlFunction,
  type SingleAccessControl,
  type MinimalUser,
} from "../../services/auth/access-control-types";
