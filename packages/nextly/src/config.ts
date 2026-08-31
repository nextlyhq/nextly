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
export type {
  PreviewViewport,
  PreviewViewportsDeclaration,
} from "./domains/collections/services/preview-viewports";

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

// The admin CONTRIBUTION shapes, published so the admin panel can DERIVE its
// `/admin-meta` types from the declaration the server serializes rather than
// restating them. `buildPluginAdminMeta` copies a contributed widget verbatim
// into that payload, so the two were one shape declared twice -- and they
// drifted, twice: `component` was optional on one side and required on the
// other, and the whole declarative half (`title`, `archetype`, `defaultSize`,
// `query`, `link`, ...) was added here and never on the admin's copy, so admin
// code reading a property that was present on the wire got a type error.
//
// This subpath rather than the root, and that is the load-bearing part. The
// admin's tsconfig maps the bare `nextly` specifier to `../nextly/src`, so
// importing from `"nextly"` shadows the package exports and pulls core's whole
// source tree in behind internal `@nextly/*` aliases that project does not
// declare. `nextly/config` is not covered by that mapping, so it resolves
// through the export map to the built declaration bundle the way any consumer's
// would -- which is what makes the derivation reachable at all.
//
// Types only: `export type` carries no runtime binding, so nothing here adds a
// byte to the config entry point's bundle.
export type {
  ComponentPath,
  HeaderButtonId,
  PluginAdminWidget,
} from "./plugins/admin-contributions";
//
// Taken from the leaf modules rather than from `domains/widgets/index.ts`: that
// barrel also carries `executeWidgetQuery`, and through it the Direct API, which
// is exactly the weight this entry point exists to keep out of a
// `nextly.config.ts`.
//
// `WidgetDefinition` is here for the same derivation reason as the contribution
// shapes above: `/api/admin-meta/workspace` serializes the registry verbatim, so
// the admin reads exactly this shape off the wire and restating it there would
// be one contract declared twice.
export type {
  WidgetArchetype,
  WidgetDefinition,
  WidgetHeight,
  WidgetSize,
} from "./domains/widgets/definition";
export type { WidgetQuery } from "./domains/widgets/query";
// A VALUE, and the only one in this block. The admin batches a dashboard's
// widgets into requests `POST /api/dashboard/query` will accept, so it needs the
// number that endpoint refuses above -- and a second copy of it on the client
// would send a batch the server rejects the day the two diverged. Its module has
// no imports, so taking it here costs a `nextly.config.ts` nothing.
export { MAX_QUERIES_PER_REQUEST } from "./domains/widgets/batch-limit";
export type {
  WidgetOp,
  WidgetSourceField,
  WidgetSourceFieldType,
  WidgetSourceKind,
} from "./domains/widgets/sources";

// A code-first `preview.url` built from a `{field}` path. Exported because a
// package that ships a collection in code — the page builder's `pages`, say —
// can only express its preview as a function, while the path is what its host
// naturally configures. Sharing the one substitution rule keeps a template and
// a function from drifting into two different addresses for the same entry.
export { previewUrlFromTemplate } from "./domains/collections/services/preview-url-resolver";
