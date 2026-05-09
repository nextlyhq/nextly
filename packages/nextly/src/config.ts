/**
 * Config Entry Point
 *
 * This entry point exports only config-related utilities that don't
 * depend on Next.js or other heavy dependencies. It's designed to be
 * imported from nextly.config.ts files where we want to avoid pulling
 * in the full nextly package.
 *
 * @module nextly/config
 * @since 1.0.0
 */

// Collection configuration (defineCollection, CollectionConfig, etc.)
export {
  defineCollection,
  type CollectionConfig,
  type CollectionLabels,
  type CollectionAdminOptions,
  type CollectionPagination,
  type CollectionAccessControl,
  type CollectionHooks,
  type CustomEndpoint,
  type HttpMethod,
  type HookHandler,
} from "./collections/config/define-collection";

// Single configuration (defineSingle, SingleConfig, etc.)
export {
  defineSingle,
  type SingleConfig,
  type SingleLabel,
  type SingleAdminOptions,
  type SingleAccessControl,
  type SingleHooks,
} from "./singles/config/define-single";

// Hook types for collection hooks
export type { HookContext } from "./hooks/types";

// Nextly config (defineConfig for nextly.config.ts)
export {
  defineConfig,
  sanitizeConfig,
  type NextlyConfig,
  type SanitizedNextlyConfig,
  type TypeScriptConfig,
  type DatabaseConfig,
  type RateLimitingConfig,
  type SanitizedRateLimitingConfig,
} from "./collections/config/define-config";

// Storage plugin types (for advanced usage)
export type {
  StoragePlugin,
  StoragePluginConfig,
  CollectionStorageConfig,
  CollectionStorageMap,
} from "./storage/types";

// Rate limiting (for custom stores)
export {
  type RateLimitStore,
  type RateLimitRecord,
} from "./middleware/rate-limit";

// Branding helpers (for server-side CSS injection)
export { getBrandingCss } from "./utils/color-utils";

// Component configuration (defineComponent, ComponentConfig, etc.)
export {
  defineComponent,
  type ComponentConfig,
  type ComponentLabel,
  type ComponentAdminOptions,
} from "./components/config";

// Field builders and related runtime guards used in collection definitions.
export {
  text,
  textarea,
  richText,
  email,
  password,
  code,
  number,
  checkbox,
  date,
  select,
  radio,
  upload,
  relationship,
  array,
  repeater,
  group,
  json,
  component,
  chips,
  option,
} from "./collections/fields/helpers";

export {
  isTextField,
  isTextareaField,
  isRichTextField,
  isEmailField,
  isPasswordField,
  isCodeField,
  isNumberField,
  isCheckboxField,
  isDateField,
  isSelectField,
  isRadioField,
  isUploadField,
  isRelationshipField,
  isRepeaterField,
  isGroupField,
  isJSONField,
  isComponentField,
  isChipsField,
  isDataField,
  hasNestedFields,
  isRelationalField,
} from "./collections/fields/guards";

export type * from "./collections/fields/types";
