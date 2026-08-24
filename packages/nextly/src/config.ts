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

// The context a FIELD-level hook is handed. `FieldHooks` is already public
// through the field types below, so the handler it is declared with is too.
export type { FieldHookContext, FieldHookHandler } from "./hooks/types";

// Single configuration (defineSingle, SingleConfig, etc.)
export {
  defineSingle,
  type SingleConfig,
  type SingleLabel,
  type SingleAdminOptions,
  type SingleAccessControl,
  type SingleHooks,
  type SinglePreviewConfig,
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

// Multilingual (i18n) config types
export type {
  LocalizationConfig,
  LocaleInput,
  ResolvedLocale,
  SanitizedLocalizationConfig,
} from "./domains/i18n/config/types";

// Field-localization classifiers — shared by storage generation and the admin UI so both
// agree on which fields are translatable vs. shared (the smart per-type defaults live here).
export {
  isFieldLocalized,
  defaultLocalizedForType,
  resolveLocalizedFieldNames,
} from "./domains/i18n/classify-fields";

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

// Component configuration (defineFieldGroup, FieldGroupConfig, etc.)
export {
  defineFieldGroup,
  type FieldGroupConfig,
  type FieldGroupLabel,
  type FieldGroupAdminOptions,
} from "./field-groups/config";

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
  fieldGroup,
  chips,
  option,
} from "./collections/fields/helpers";

// The factory a contributed field type is declared through. A value, not a
// type: the block above this one re-exports the field types with `export type`,
// which carries no runtime binding, so a caller would resolve the symbol at
// compile time and find nothing at run time.
export {
  pluginField,
  pluginFieldBrand,
} from "./collections/fields/types/plugin-field";

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
  isFieldGroupField,
  isChipsField,
  isDataField,
  hasNestedFields,
  isRelationalField,
} from "./collections/fields/guards";

export type * from "./collections/fields/types";

// Plugin identity and classification. Both modules are import-free, so the
// admin can share the exact implementations the server uses without pulling
// the plugin runtime into a browser bundle. Sharing them is the point: a slug
// derived two ways produces dead links, and a category vocabulary held in two
// places starts accepting values plugins cannot declare.
export {
  PLUGIN_CATEGORIES,
  isPluginCategory,
  type PluginCategory,
} from "./plugins/plugin-categories";
export { pluginAdminSlug } from "./plugins/plugin-slug";

// A code-first `preview.url` built from a `{field}` path. Exported because a
// package that ships a collection in code — the page builder's `pages`, say —
// can only express its preview as a function, while the path is what its host
// naturally configures. Sharing the one substitution rule keeps a template and
// a function from drifting into two different addresses for the same entry.
export { previewUrlFromTemplate } from "./domains/collections/services/preview-url-resolver";
