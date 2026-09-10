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
// And the same for a plugin's HTTP routes, for the same reason and with a
// sharper consequence. `pluginAdminSlug` derived twice produces a dead link;
// this derived twice produces a request to a path nothing serves, which the
// caller sees as an empty answer rather than as an error. The admin needs it
// because a plugin's own UI calling its own route has to address it, and the
// dispatcher is the only thing that knows where that is.
export { pluginRouteFullPath } from "./plugins/routes/route-path";
// The mount travels with the path builder, so a client that resolves a route
// names the same union the server declared it with.
export type { PluginRouteMount } from "./plugins/routes/route-types";

// The VERBS those routes may declare, published beside the path helper and for
// the same reason: the admin's client for calling a plugin route has to know
// which methods exist, and a second list of them is a narrower view that stops
// covering the wider one the moment a method is added — the plugin declares a
// route the admin cannot call, and nothing fails. A pure string union, so this
// costs the browser nothing.
export type { RouteMethod } from "./plugins/routes/route-types";

// And what may travel as one of those routes' bodies. Published here for the
// same reason: the admin's client serialises with `JSON.stringify`, so a value
// outside this set is not sent as written — a `Date` becomes a string, a `Map`
// or `FormData` becomes `{}`, a function is dropped, a bigint throws. Stating
// the set makes the compiler refuse those where the author can still see what
// they meant.
export type { JsonValue } from "./plugins/admin-contributions";

// And what a plugin route may have to say about a write that already
// committed. Published here for the same reason the two above are: a plugin
// route reporting a post-commit hook failure and the plugin UI reading that
// report are two halves of one package, and only one of them may load the
// framework. Without a shared name the browser half either restates the shape
// -- a second definition that drifts the first time a field is added -- or
// types the field as `unknown` and stops being able to say anything about it.
// A pure interface of strings, so this costs the browser nothing.
export type { HookWarning } from "./hooks/side-effect-warnings";

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
  DeclarativeWidgetArchetype,
  HeaderButtonId,
  PluginAdminCustomWidget,
  PluginAdminDataWidget,
  PluginAdminDeclarativeWidget,
  PluginAdminQuerylessWidget,
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
  DataWidgetArchetype,
  QuerylessWidgetArchetype,
  CellWidgetArchetype,
  WidgetDefinition,
  WidgetSetting,
  WidgetAction,
  WidgetStatCell,
  WidgetHeight,
  WidgetSize,
  WidgetChrome,
} from "./domains/widgets/definition";
export type { WidgetQuery } from "./domains/widgets/query";
// A VALUE, and for the same reason as the batch limit below: the admin resolves
// a contributed widget's deprecated `size` alias into the enum, and so does the
// server when it reduces the same declaration to a canonical summary. Two
// copies of that mapping is two answers to one question, and the copies had
// already drifted -- only one of them existed.
export { legacySizeToWidgetSize } from "./domains/widgets/definition";
/*
 * The admin applies a reader's stored settings to the query it composes, so the
 * rule that decides which setting drives which knob is exported rather than
 * restated there — one implementation of a question two layers ask.
 */
export {
  applyWidgetSettings,
  resolveWidgetSettings,
} from "./domains/widgets/settings";
// Which field NAMES an entry. The admin draws a column with it, the activity
// feed labels a row with it, and the dashboard's generated list widgets pick a
// row label with it -- so it is one answer here rather than one per consumer.
// `readableTitleText` is the VALUE half of the same question and travels with
// it: which field names an entry and whether that field's value can name one
// are decided together, and answering the second per consumer is how three
// spellings of it came to disagree about whitespace, numbers and bigints.
export {
  COMMON_TITLE_FIELDS,
  entryTitleField,
  readableTitleText,
} from "./domains/collections/entry-title";
// A VALUE, and the only one in this block. The admin batches a dashboard's
// widgets into requests `POST /api/dashboard/query` will accept, so it needs the
// number that endpoint refuses above -- and a second copy of it on the client
// would send a batch the server rejects the day the two diverged. Its module has
// no imports, so taking it here costs a `nextly.config.ts` nothing.
export { MAX_QUERIES_PER_REQUEST } from "./domains/widgets/batch-limit";
// Also a VALUE, and for the same reason. The layout endpoint refuses a
// submission carrying more placements than this, so the editor has to know the
// number to stop a reader building an arrangement that can never be saved --
// and a second copy of it on the client is a second answer that drifts.
export {
  COLUMN_COUNTS,
  DEFAULT_COLUMN_COUNT,
  MAX_PLACEMENTS,
  type ColumnCount,
} from "./domains/widgets/layout";
// The VALUE as well as the type. A widget result names each column's kind, and
// the admin has to decide which kinds it can present -- deriving that from this
// tuple is what stops the browser silently erasing a kind core has started to
// emit. `sources.ts` reaches only `NextlyError` and an import-free helper, so
// publishing it on this client-safe surface pulls no server code after it.
export { WIDGET_SOURCE_FIELD_TYPES } from "./domains/widgets/sources";
// The interval vocabulary, on this client-safe surface for the same reason the
// field types are: the admin has to label a timeline's axis and decide it can
// draw the width it was handed, and re-listing the intervals in the browser is
// a second copy that agrees on the day it is written.
//
// Taken from `timeseries-interval`, which carries no database import. The
// expression builder beside it reaches Drizzle, and exporting the vocabulary
// from THERE put `drizzle-orm` in the admin's browser bundle -- refused by
// `client-bundle-boundary.test.ts`, which is why the two are separate modules.
export {
  isTimeseriesInterval,
  TIMESERIES_INTERVALS,
} from "./domains/collections/query/timeseries-interval";
export type { TimeseriesInterval } from "./domains/collections/query/timeseries-interval";
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

// The web font formats, for the same reason MAX_QUERIES_PER_REQUEST is here: a
// second copy on the client is a copy that drifts. The admin dropzone decides
// in the BROWSER what a person may drag, before any request exists, so a format
// this server accepts and that map omits is one nobody can upload — and one the
// map admits and the server refuses is a rejection an author only sees after
// the upload. Its module has no imports, so taking it here costs a
// `nextly.config.ts` nothing.
export {
  WEB_FONT_FORMATS,
  WEB_FONT_MIME_TYPES,
  webFontMimeFromFilename,
} from "./services/upload-validation/web-fonts";
// The formats an upload may carry, with the suffixes they wear on disk. The
// admin's dropzone decides in the BROWSER what may be dragged, and a list of
// its own drifts from this one — which is how a picker comes to advertise a
// format the server refuses and refuse one the server accepts.
export {
  DEFAULT_ACCEPTED_FORMATS,
  DEFAULT_ALLOWED_MIME_TYPES,
} from "./services/upload-validation/mime";
export type { AcceptedFormat } from "./services/upload-validation/mime";
export type { WebFontFormat } from "./services/upload-validation/web-fonts";

// The API-key authorization policy. Exported here so the admin's route guards
// and controls derive from the same declaration the endpoints enforce, rather
// than restating the action-or-update umbrella a second time.
export {
  API_KEY_RESOURCE,
  API_KEY_ACTION_POLICY,
  apiKeyPermissionsFor,
  apiKeyPermissionSlugsFor,
  type ApiKeyOperation,
} from "./domains/auth/api-key-policy";
