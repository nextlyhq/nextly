// Release-pipeline test (0.0.136): verifies the consolidated v0.0.X
// GitHub Release workflow introduced in #1243. No runtime impact.

// of nextly. Anything that statically imports `next/navigation`,
// `next/cache`, `next/headers`, etc. lives behind the
// `nextly/runtime` subpath instead. Keeping the root clean is
// what lets the CLI, plugin authors, and config loaders import from
// the package without dragging Next.js into a Node-only context.
//
// If you find yourself wanting to add a re-export here that pulls
// `routeHandler.ts`, `api/with-error-handler.ts`, `actions/with-action.ts`,
// `actions/upload-media.ts`, or anything reachable from those files —
// move it under `runtime.ts` (which is exported from the
// `nextly/runtime` subpath) and update consumers there.
export {
  ServiceDispatcher,
  type ServiceType,
  type OperationType,
  type DispatchRequest,
  type DispatchResult,
} from "./services/dispatcher";
export { ServiceContainer } from "./services/index";

// Export dynamic collections services and types
export {
  DynamicCollectionService,
  CollectionFileManager,
  CollectionsHandler,
  type CollectionArtifacts,
  type CreateCollectionInput,
  type UpdateCollectionInput,
} from "./services/index";
export type {
  FieldDefinition,
  CollectionSchemaDefinition,
  DynamicCollection,
  NewDynamicCollection,
} from "./schemas/dynamic-collections";

// Export pagination types
export type {
  PaginatedResponse,
  BuildPaginatedResponseOptions,
} from "./types/pagination";
export {
  buildPaginatedResponse,
  clampLimit,
  calculateOffset,
  PAGINATION_DEFAULTS,
} from "./types/pagination";

// Export Zod schemas for validation
export * from "./schemas/index";

// Export database engine exports (adapters, migrations, etc.)
export * from "./database/index";

// ============================================================
// DATABASE ADAPTER TYPES
// ============================================================

// Re-export common types from @nextlyhq/adapter-drizzle for convenience.
// Users can import these directly from 'nextly' instead of separate packages.

// DrizzleAdapter class (for extending or type checking)
export { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

// Common adapter types
export type {
  DatabaseCapabilities,
  TransactionContext,
  WhereClause,
  SelectOptions,
} from "@nextlyhq/adapter-drizzle/types";

// Export database lifecycle hooks API
export * from "./hooks";

// Explicit hook exports to prevent tree-shaking from removing them
export {
  getHookRegistry,
  resetHookRegistry,
  HookRegistry,
} from "./hooks/hook-registry";

export {
  registerCollectionHooks,
  clearCollectionHooks,
  reregisterCollectionHooks,
  type RegisterCollectionHooksResult,
} from "./hooks/register-collection-hooks";

export {
  registerSingleHooks,
  clearSingleHooks,
  reregisterSingleHooks,
  type RegisterSingleHooksResult,
} from "./hooks/register-single-hooks";

// ============================================================
// INITIALIZATION API
// ============================================================

// Main initialization API - recommended for most applications
export {
  getNextly,
  getCachedNextly,
  shutdownNextly,
  createRegister,
  type Nextly,
  type NextlyServiceConfig as NextlyConfig,
  type GetNextlyOptions,
} from "./init";

// ============================================================
// DIRECT API
// ============================================================

// Convenience object - lazily delegates to the Direct API singleton.
// Import and use directly: `import { nextly } from 'nextly'`
export { nextly } from "./direct-api";

// Canonical NextlyError — re-exported here for ergonomic catch-block use.
// For richer surface (codes, public-data types, etc.) import from
// `nextly/errors`. Use the static type guards on `NextlyError`
// (e.g. `NextlyError.isNotFound(err)`) — the legacy `is*Error` helpers
// were removed in PR 12 (final unified-error-system cleanup).
export { NextlyError } from "./errors";

// Direct API types - type-safe slug resolution (for generated types integration)
export type {
  GeneratedTypes,
  CollectionSlug,
  SingleSlug,
  FieldGroupSlug,
  DataFromCollectionSlug,
  DataFromSingleSlug,
  InProcessRow,
  RowFromCollectionSlug,
  RowFromSingleSlug,
  DataFromFieldGroupSlug,
} from "./direct-api/types";

// Direct API types - the `nextly.fieldGroups.*` namespace. Exported from the
// root because they are the argument and result types of a public namespace:
// without them a caller cannot annotate a variable holding what it returns.
export type {
  FieldGroupDefinition,
  FindFieldGroupsArgs,
  FindFieldGroupBySlugArgs,
  CreateFieldGroupArgs,
  UpdateFieldGroupArgs,
  DeleteFieldGroupArgs,
} from "./direct-api/types";

// The vocabulary a caller needs to answer `DirectAPIConfig.trusted`. Exported
// as a VALUE, not only a type: the escape hatch is a constant a caller has to
// be able to write, and a bound it cannot name is a bound it will not draw.
export {
  TRUSTS_EVERY_COLLECTION,
  type TrustBound,
} from "./services/collections/trust-grant";

// Direct API types - core operation argument types
export type {
  DirectAPIConfig,
  FindArgs,
  FindByIDArgs,
  CreateArgs,
  UpdateArgs,
  DeleteArgs,
  CountArgs,
  BulkDeleteArgs,
  DuplicateArgs,
  FindSingleArgs,
  UpdateSingleArgs,
  CountResult,
  DeleteResult,
  BulkOperationResult as DirectAPIBulkOperationResult,
  // Templates and downstream consumers import these to type Direct API
  // results without reaching into internal modules. The deprecated
  // migrated every in-tree consumer to `ListResult<T>`.
  ListResult,
  MutationResult,
  PaginationMeta,
  // Auth types
  LoginArgs,
  RegisterArgs,
  ChangePasswordArgs,
  ForgotPasswordArgs,
  ResetPasswordArgs,
  VerifyEmailArgs,
  LoginResult,
  AuthResult,
  UserContext,
  // User types
  FindUsersArgs,
  FindUserByIDArgs,
  CreateUserArgs,
  UpdateUserArgs,
  DeleteUserArgs,
  // Media types
  UploadFileData,
  UploadMediaArgs,
  FindMediaArgs,
  FindMediaByIDArgs,
  UpdateMediaArgs,
  DeleteMediaArgs,
  BulkDeleteMediaArgs,
  ListFoldersArgs,
  CreateFolderArgs,
  // Form types
  FormsConfig,
  FindFormsArgs,
  FindFormBySlugArgs,
  SubmitFormArgs,
  SubmitFormResult,
  FormSubmissionsArgs,
  // Query types
  PopulateOptions,
  RequestContext as DirectAPIRequestContext,
  WhereFilter,
  QueryOperator,
  FieldCondition,
  // Email Provider types
  FindEmailProvidersArgs,
  FindEmailProviderByIDArgs,
  CreateEmailProviderArgs,
  UpdateEmailProviderArgs,
  DeleteEmailProviderArgs,
  SetDefaultProviderArgs,
  TestEmailProviderArgs,
  // Email Template types
  FindEmailTemplatesArgs,
  FindEmailTemplateByIDArgs,
  FindEmailTemplateBySlugArgs,
  CreateEmailTemplateArgs,
  UpdateEmailTemplateArgs,
  DeleteEmailTemplateArgs,
  PreviewEmailTemplateArgs,
  // User Field types
  FindUserFieldsArgs,
  FindUserFieldByIDArgs,
  CreateUserFieldArgs,
  UpdateUserFieldArgs,
  DeleteUserFieldArgs,
  ReorderUserFieldsArgs,
  // Email Send types
  SendEmailArgs,
  SendTemplateEmailArgs,
  SendEmailResult,
} from "./direct-api/types";

// TypeGenerator types - for advanced type generation use cases
export type {
  TypeGeneratorOptions,
  GeneratedTypeInterface,
  GeneratedSingleTypeInterface,
  GeneratedUserInterface,
  GeneratedTypesFile,
} from "./domains/schema/services/type-generator";

// ============================================================
// ADVANCED DI API (for power users)
// ============================================================

// Schema apply pipeline — used by seed scripts and template authors
// who register collections/singles via the registry services and then
// need the physical `dc_*` / `single_*` tables to be created in the
// same boot. Mirrors what the visual admin UI's applySchemaChanges
// dispatcher does internally.
export {
  applyDesiredSchema,
  buildDesiredSchemaFromRegistry,
  buildDesiredSchemaFromRegistryAsync,
  type ApplyResult,
  type DesiredSchema,
  type DesiredCollection,
  type DesiredSingle,
  type DesiredFieldGroup,
  type DesiredSchemaOverrides,
  type SchemaApplyErrorCode,
} from "./domains/schema/pipeline";

// DI Container - for advanced use cases
export { Container, container, type Factory } from "./di";

// Service Registration
export {
  registerServices,
  shutdownServices,
  getService,
  isServicesRegistered,
  clearServices,
  type NextlyServiceConfig,
  type ServiceMap,
} from "./di";

// Validation Types and Utilities
export type {
  ValidationErrorCode,
  ValidationError,
  ValidationResult,
  ValidationErrorResponse,
} from "./validation";
export {
  VALIDATION_ERROR_CODES,
  isValidationErrorCode,
  isValidationError,
  isValidationResult,
  createValidationError,
  validResult,
  invalidResult,
  createValidationErrorResponse,
  // Error Formatting Utilities
  formatZodError,
  mergeValidationResults,
  toApiResponse,
} from "./validation";

// ============================================================
// NEW SERVICE LAYER EXPORTS
// ============================================================

// Core Services - New unified services with ServiceError pattern
export { CollectionService } from "./services/collections/collection-service";
export type {
  Collection,
  CollectionEntry as CollectionDocument,
  ListCollectionsOptions,
} from "./services/collections/collection-service";

export { UserService } from "./services/users/user-service";
export type {
  User,
  CreateUserInput as CreateUserServiceInput,
  UpdateUserInput as UpdateUserServiceInput,
  ListUsersQueryOptions,
  PasswordHasher,
} from "./services/users/user-service";

export { MediaService } from "./services/media/media-service";
export type {
  MediaFile,
  MediaType,
  UploadMediaInput,
  UpdateMediaInput,
  ListMediaOptions,
  MediaFolder,
  CreateFolderInput,
  UpdateFolderInput,
  FolderContents,
  BulkOperationResult,
} from "./services/media/media-service";

// Re-export StorageProvider as type alias for IStorageAdapter
export type { IStorageAdapter as StorageProvider } from "./storage/types";

// Shared Types - Common types used across services
export type {
  DrizzleDB,
  RequestContext,
  PaginationOptions,
  PaginatedResult,
  SortOptions,
  QueryOptions,
  ServiceDeps,
  Logger,
} from "./services/shared";
export { SYSTEM_CONTEXT, consoleLogger } from "./services/shared";

// Validating loose values against field declarations, for plugins that store
// structured content of their own and must apply the same rules a write does.
export {
  validateFieldValues,
  type ValidateFieldValuesOptions,
  type FieldValueDeclaration,
  type FieldValueDeclarationInput,
  type ValidationIssue,
} from "./plugins/validate-field-values";

// The block manifest's published contract. Exported from the package root
// because a schema nothing can import promises nothing: the file is read by an
// editor build, a docs page or an agent, and none of them can reach an internal
// module through the export map.
export {
  BLOCK_MANIFEST_FILENAME,
  BLOCK_MANIFEST_VERSION,
  blockManifestJsonSchema,
  blockManifestSchema,
  blockManifestEntrySchema,
  type BlockManifest,
  type BlockManifestEntry,
} from "./plugins/codegen/block-manifest";

// The block document format's published contract, exported for the same reason
// as the manifest above: the things that most need to check a document against
// the format — a generator, an editor build, an agent writing a page — are the
// ones with no way to reach an internal module.
export {
  blockDocumentJsonSchema,
  parseBlockDocument,
  type BlockDocumentParseResult,
} from "./plugins/codegen/block-document";
// The success shape's `data` IS a `BlockDocument`, so a consumer that parses a
// document cannot name what it got back without reaching past this barrel into
// the engine. Re-exported from the engine, which owns the type, so the parser
// and the shape it returns arrive together.
export type { BlockDocument } from "@nextlyhq/blocks-engine";

// Plugin System - Types and helpers for creating plugins
export {
  AdminPlacement,
  collectDeclarations,
  definePlugin,
  createPluginContext,
  // Runtime companions to `PluginCategory`, so a plugin author can enumerate
  // the vocabulary and narrow a free-form value rather than restating either.
  PLUGIN_CATEGORIES,
  isPluginCategory,
  pluginAdminSlug,
  type PluginAdminAppearance,
  type PluginAdminConfig,
  type PluginCategory,
  type PluginContext,
  type PluginContributions,
  type PluginDeclaration,
  type PluginDefinition,
  type PluginPermission,
  type PluginRole,
  type PluginEmailProvider,
  type PluginEmailTemplate,
  type PluginFieldType,
  type PluginFieldValidateArgs,
  type PluginFieldInstance,
  type PluginFieldIssue,
  type PluginFieldValidationResult,
  type PluginFieldCodegen,
  type PluginFieldCodegenImport,
  type FieldSurface,
  type ScheduledTask,
  type PermissionSlug,
  type PluginHookRegistry,
  type PluginFilterRegistry,
  type PluginActionRegistry,
  type PluginRoute,
  type PluginRouteContext,
  type PluginRouteHandler,
  type Middleware,
  type RouteMethod,
  type ComponentPath,
  type JsonObject,
  type JsonValue,
  type PluginAdminContributions,
  type PluginAdminPage,
  type PluginAdminWidget,
  type PluginAdminCustomWidget,
  type PluginAdminDataWidget,
  type PluginAdminDeclarativeWidget,
  type PluginAdminQuerylessWidget,
  type DeclarativeWidgetArchetype,
  type PluginCollectionView,
  type PluginMenuItem,
  type PluginNavSection,
} from "./plugins";

// The widget domain's public surface: the registry every core and
// plugin-contributed widget shares, the source registry a query names, and
// the validated query shape itself.
// Every contract a published shape NAMES is published beside it. There is no
// `nextly/widgets` subpath, so this is the only place a plugin author can
// reach them, and a public property whose type has no public name can be
// inferred but never annotated: `WidgetDefinition.defaultHeight` is a
// `WidgetHeight`, and `WidgetSource` is built out of `WidgetSourceField`,
// `WidgetSourceKind` and `WidgetOp`.
export {
  WIDGET_SIZES,
  WIDGET_HEIGHTS,
  WIDGET_ARCHETYPES,
  WIDGET_SOURCE_KINDS,
  WIDGET_SOURCE_FIELD_TYPES,
  WIDGET_OPS,
  registerWidget,
  overrideWidget,
  extendWidget,
  deregisterWidget,
  getWidget,
  listWidgets,
  registerSource,
  listSources,
  validateWidgetQuery,
  MAX_WIDGET_LIMIT,
  type WidgetDefinition,
  type WidgetQuery,
  type WidgetSize,
  type WidgetHeight,
  type WidgetArchetype,
  type DataWidgetArchetype,
  type QuerylessWidgetArchetype,
  type WidgetSource,
  type WidgetSourceField,
  type WidgetSourceFieldType,
  type WidgetSourceKind,
  type WidgetOp,
  type WidgetPatch,
} from "./domains/widgets";

// Value exports for the email provider contract. A plugin calls
// defineEmailProvider so its own config type is checked where the definition is
// written, and erased only at the boundary the registry stores it behind.
export {
  defineEmailProvider,
  MAX_EMAIL_PROVIDER_TYPE_LENGTH,
} from "./domains/email/provider-definition";
export type {
  EmailProviderDefinition,
  EmailProviderConfigField,
  EmailProviderCapabilities,
  EmailProviderDescriptor,
  ProviderAvailability,
  RegisteredEmailProvider,
} from "./domains/email/provider-definition";

// Field-type registry lookup (C7/D16) — lets a plugin/host ask whether a
// contributed field type may appear on a given admin surface, so surfaces
// (e.g. the form builder) can validate a plugin field type the same way core
// does. Built-ins return false; each caller keeps its own built-in handling.
export {
  isPluginFieldTypeOnSurface,
  getFieldType as getPluginFieldType,
} from "./domains/schema/field-types/field-type-registry";

// Block props on the field system — a block's prop declarations become
// ordinary field configs, so block values validate through the same pass
// entries do instead of a parallel rule set.
export {
  blockPropsToFieldConfigs,
  validateBlockPropValues,
  type BlockPropDeclaration,
  type BlockPropsSource,
} from "./collections/fields/block-props";

// The block-prop surface: which field types a block prop may declare, and
// which data fields may be bound into one. Both derive from the prop's type,
// never from a per-block opt-in.
export {
  BLOCK_FIELD_TYPES,
  BLOCK_FIELD_TYPE_CATALOG,
  BINDABLE_KINDS,
  FIELD_TYPE_BINDING_KIND,
  STORAGE_PRIMITIVE_AS_FIELD_TYPE,
  isBlockFieldType,
  isBindablePropType,
  bindingKindOf,
  canBindFieldToProp,
  type BlockFieldCatalogType,
  type BindingEndpoint,
  type BindingValueKind,
  type FieldStoragePrimitive,
} from "./collections/fields/catalog";

// Managed-services elevation (D35) — `ctx.services` ServiceOpts + the auth user.
export type {
  ServiceOpts,
  PluginCollectionService,
} from "./plugins/service-opts";
// Exported alongside `PluginCollectionService` because a plugin typing its own
// helper against `ctx.services.singles` needs to name the type, and an
// unexported one leaves it reaching into a deep path or widening to `unknown`.
export type {
  PluginSinglesService,
  PluginSinglesResult,
  PluginSingleRecord,
  SerializedFieldConfig,
} from "./plugins/plugin-singles";
export type { AuthUser } from "./types/auth";

// Auth extensibility (D71/D57) — pluggable strategies + auth-flow hooks +
// challenge protocol. @experimental until a first-party plugin exercises it (D55).
export type {
  AuthInput,
  AuthOutcome,
  AuthStrategy,
  Challenge,
  ChallengeDefinition,
  AuthHooks,
  AuthHookName,
} from "./auth/pipeline/types";

// Managed data access (D56) — bulk-create result for
// `ctx.services.collections.createMany`. Rich-query options (`QueryOptions`
// with where/sort/depth/select) + `PaginatedResult` are exported with the other
// shared service types above.
export type { BatchOperationResult } from "./domains/collections/services/collection-types";

// Whether a collection stores a working draft beside its published row.
//
// Exported because a plugin cannot answer it and cannot safely guess. The split
// resolves from five conditions together — versioning resolving
// `drafts.enabled`, `status: true`, no reachable password field, every
// reachable component schema resolving, and no component carrying one — and
// `status: true` alone, the obvious flag, is true for collections that store no
// draft at all. A plugin keying data by published/draft therefore writes rows
// against a document that does not exist, and nothing downstream can tell those
// rows from real ones.
//
// The reason travels with the verdict rather than being reduced to a boolean,
// so a caller can say WHY a collection it expected to draft does not.
//
// `collectionDraftSplit` takes the collection AS AUTHORED. The two functions
// beside it do not: one wants component schemas already resolved, the other
// wants `versions` in the `{ drafts: { enabled } }` shape that only exists
// after config load. An author writes `versions: true`, and handing that to
// either is rejected by the checker — or, from untyped code, silently answers
// `false` for a collection whose drafts are on.
//
// Root entry, not `nextly/config`: this reaches the component registry through
// the DI container, and `config` is a CLIENT entry — publishing it there would
// pull the server graph into a browser bundle.
export { collectionDraftSplit } from "./domains/versions/draft-split-eligibility";
export type {
  AuthoredDraftSplitCollection,
  DraftSplitEligibility,
  DraftSplitDisabledReason,
} from "./domains/versions/draft-split-eligibility";

// Which fields a level addresses, with presentational groups flattened.
// Exported because a plugin that walks a collection's fields was otherwise
// reaching into core's file layout, and a second copy of this walk is a second
// answer to one question.
export { addressableFields } from "./shared/addressable-fields";
export type {
  AddressableFieldsOptions,
  AddressableField,
  UnvalidatedAddressableField,
} from "./shared/addressable-fields";

// What a form answers a visitor who reaches it. Exported because the plugin
// that contributes the forms collection refuses submissions too, and a second
// implementation of this is how the four public paths came to disagree.
export {
  formAvailability,
  GENERIC_REFUSAL,
  NO_SUCH_FORM,
  type FormAvailability,
  type FormAvailabilityInput,
} from "./domains/forms/form-availability";

// The same question asked of a collection the SCHEMA BUILDER created, whose
// record is not authored config.
//
// A Builder collection lives in the dynamic registry, and that registry stores
// `versions` already RESOLVED — `dynamic_collections.versions` holds a
// `ResolvedVersionsConfig`. So the authored form above is the one shape it can
// never take: the checker rejects it, and untyped code gets `false` for a
// collection whose drafts are on, because nothing named `drafts.enabled` is
// read. A caller holding a registry record needs this one.
//
// Two functions rather than one accepting either, because the two inputs
// overlap in neither direction and a single function would have to GUESS which
// it was handed. `versions: true` and `{ drafts: { enabled: true } }` are both
// objects-or-booleans that a runtime check can misread, and guessing wrong
// fails silently in the direction that disables drafts.
//
// Renamed at this boundary. `schemaDraftSplit` is named for the caller it was
// written for — the schema-read path — and a public name has to say what it
// TAKES, because that is the only thing a plugin author choosing between the
// two can see.
export { schemaDraftSplit as resolvedCollectionDraftSplit } from "./domains/versions/draft-split-eligibility";

// Background jobs. Exported from the root entry rather than only from the
// domain barrel: a barrel that no published entry re-exports is unreachable
// from an installed application, so the feature would exist for this
// repository's own tests and for nobody else.
export {
  DEFAULT_MAX_ATTEMPTS,
  MAX_JOB_SLUG_LENGTH,
  defineJob,
  JobRegistry,
} from "./domains/jobs/job-registry";
export type {
  JobContext,
  JobDefinition,
  JobDefinitionInput,
  JobRetryPolicy,
} from "./domains/jobs/job-registry";
export { JobsRepository } from "./domains/jobs/jobs-repository";
export type {
  EnqueueResult,
  JobRow,
  NewJob,
} from "./domains/jobs/jobs-repository";
export { runJobsPass } from "./domains/jobs/jobs-runner";
export type { RunJobsPassOptions } from "./domains/jobs/jobs-runner";
export type { RunJobsResult } from "./domains/jobs/run-jobs";
// The QUEUE side. `nextly.jobs.queue` is the call almost every application
// makes; everything above it is the machinery that then runs the work, and only
// an application assembling its own runner needs those.
export type {
  JobInputFor,
  JobSlug,
  QueueJobArgs,
  QueueJobResult,
} from "./direct-api/types/jobs";

// The release materialiser, as a job definition. Exported so an application can
// register it with the runner today: the periodic trigger that would register it
// automatically is separate work, and until it lands a definition nobody can
// reach is a definition that never runs.
export {
  RELEASES_DRAIN_JOB,
  createReleasesDrainJob,
} from "./domains/releases/releases-drain-job";
export { applyDueReleases } from "./domains/releases/apply-due-releases";
export type {
  ApplyDueReleasesResult,
  MaterialisationFailure,
} from "./domains/releases/apply-due-releases";

export type { SchemaEligibilityCollection as ResolvedDraftSplitCollection } from "./domains/versions/draft-split-eligibility";

// The projection that makes the line above USABLE from its documented
// producer. `getCollection()` is declared to return `Collection`, which has no
// root-level `fields`, `status` or `versions`, so its result is not assignable
// to `ResolvedDraftSplitCollection` however faithfully the record carries them.
export { resolvedCollectionView } from "./domains/versions/resolved-collection-view";

// Plugin event bus (D8/D51) — `ctx.events` surface + types.
export {
  EventBus,
  getEventBus,
  resetEventBus,
  type EventEnvelope,
  type EventHandler,
  type EventName,
  DocumentEvents,
  AuthEvents,
  MediaEvents,
  type DocumentEventName,
  type AuthEventName,
  type MediaEventName,
} from "./events";

// Plugin filter/action registry (D63) — ctx.filters / ctx.actions surface + seam types.
export {
  FilterRegistry,
  getFilterRegistry,
  resetFilterRegistry,
  FilterSeams,
  type Filter,
  type Action,
  type FilterName,
  type CoreFilterSeam,
  type EmailPayloadFilterValue,
  type EmailFilterContext,
  type EmailAfterSendValue,
  type NavCollectionItem,
  type NavFilterContext,
  type ListQueryWhere,
  type ListQueryFilterContext,
} from "./filters";

// ============================================================
// COLLECTIONS & FIELD TYPES
// ============================================================

// Field types, guards, and helpers
export * from "./collections/fields";

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
  // Access control types (shared by collections, singles, and Direct API)
  type AccessControlContext,
  type AccessControlFunction,
  type MinimalUser,
} from "./collections/config";

// Collection configuration validation
export {
  validateCollectionConfig,
  assertValidCollectionConfig,
  type ValidationError as CollectionValidationError,
  type ValidationResult as CollectionValidationResult,
  type ValidationErrorCode as CollectionValidationErrorCode,
  RESERVED_SLUGS,
  SQL_RESERVED_KEYWORDS,
} from "./collections/config";

// Nextly config (defineConfig for nextly.config.ts)
export {
  defineConfig,
  type NextlyConfig as NextlyUserConfig,
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
} from "./collections/config";

// ============================================================
// MIDDLEWARE
// ============================================================

// Rate limiting middleware
export {
  createRateLimiter,
  createRateLimitHeaders,
  InMemoryRateLimitStore,
  type RateLimitConfig,
  type RateLimitStore,
  type RateLimitResult,
  type RateLimitRecord,
} from "./middleware";

// Security middleware types
export { type SecurityHeadersConfig, type CorsConfig } from "./middleware";

// ============================================================
// SINGLES
// ============================================================

// Single configuration (defineSingle, SingleConfig, etc.)
export {
  defineSingle,
  type SingleConfig,
  type SingleLabel,
  type SingleAdminOptions,
  type SingleAccessControl,
  type SingleHooks,
} from "./singles/config";

// Single configuration validation
export {
  validateSingleConfig,
  assertValidSingleConfig,
  type SingleValidationResult,
  type SingleValidationError,
  type SingleValidationErrorCode,
  RESERVED_SINGLE_SLUGS,
} from "./singles/config";

// ============================================================
// COMPONENTS
// ============================================================

// Component configuration (defineFieldGroup, FieldGroupConfig, etc.)
export {
  defineFieldGroup,
  type FieldGroupConfig,
  type FieldGroupLabel,
  type FieldGroupAdminOptions,
} from "./field-groups";

// Component configuration validation
export {
  validateFieldGroupConfig,
  assertValidFieldGroupConfig,
  type FieldGroupValidationResult,
  type FieldGroupValidationError,
  type FieldGroupValidationErrorCode,
  RESERVED_FIELD_GROUP_SLUGS,
  MAX_FIELD_GROUP_NESTING_DEPTH,
} from "./field-groups";

// Component field type (also exported from ./collections/fields via barrel export)
export type { FieldGroupFieldConfig } from "./collections/fields/types/component";

// Declares an entry field whose type a plugin contributed. `FieldConfig` is a
// closed union whose arms carry each built-in type's own errors, so it cannot
// admit a contributed type without losing them; the brand opens the authoring
// surfaces alone. The users surface solves the same problem the same way with
// `pluginUserField` below.
export {
  pluginField,
  pluginFieldBrand,
} from "./collections/fields/types/plugin-field";
export type {
  AuthorableFieldConfig,
  PluginDataFieldConfig,
  PluginFieldInput,
} from "./collections/fields/types/plugin-field";

// ============================================================
// USER MANAGEMENT
// ============================================================

// User configuration
export type {
  UserConfig,
  UserFieldConfig,
  UserPluginFieldConfig,
  UserPluginFieldInput,
  UserFieldType,
  UserAdminOptions,
} from "./users";

// Declares a user field whose type a plugin contributed, which the built-in
// arms of `UserFieldConfig` cannot be widened to admit without losing their
// own errors.
export { pluginUserField, pluginUserFieldBrand } from "./users";

// User config validation
export {
  validateUserConfig,
  assertValidUserConfig,
  RESERVED_USER_FIELD_NAMES,
  ALLOWED_USER_FIELD_TYPES,
} from "./users";

// Email configuration
export type {
  EmailConfig,
  SmtpConfig,
  ResendConfig,
  SendLayerConfig,
  EmailTemplateFn,
  EmailProviderAdapter,
} from "./services/email";

// Email provider & template record types (used by Direct API namespace return types)
export type { EmailProviderRecord } from "./schemas/email-providers/types";
export type { EmailTemplateRecord } from "./schemas/email-templates/types";

// User field definition record type (used by Direct API namespace return types)
export type { UserFieldDefinitionRecord } from "./schemas/user-field-definitions/types";

// ============================================================
// RBAC & ACCESS CONTROL
// ============================================================

// RBAC entity types (used as return types from roles/permissions namespaces)
// Note: SYSTEM_RESOURCES, isSystemResource(), isValidResource() are already
// exported via `export * from "./schemas/index"` → `export * from "./rbac"` above.
export type {
  Role,
  Permission,
  // Roles namespace args
  FindRolesArgs,
  FindRoleByIDArgs,
  CreateRoleArgs,
  UpdateRoleArgs,
  DeleteRoleArgs,
  GetRolePermissionsArgs,
  SetRolePermissionsArgs,
  // Permissions namespace args
  FindPermissionsArgs,
  FindPermissionByIDArgs,
  CreatePermissionArgs,
  DeletePermissionArgs,
  // Access namespace args
  CheckAccessArgs,
} from "./direct-api/types";

// ============================================================
// API KEY AUTHENTICATION
// ============================================================

// API key entity & token type
export type {
  ApiKeyTokenType,
  ApiKeyMeta,
  ExpiresIn,
  ApiKeyResult,
  // apiKeys namespace args
  ListApiKeysArgs,
  FindApiKeyByIDArgs,
  CreateApiKeyArgs,
  UpdateApiKeyArgs,
  RevokeApiKeyArgs,
  // access.checkApiKey() args & result
  CheckApiKeyArgs,
  CheckApiKeyResult,
} from "./direct-api/types";

// ============================================================
// SECURITY UTILITIES
// ============================================================

export {
  getTrustedClientIp,
  parseTrustedProxyIpsEnv,
  type TrustedClientIpOptions,
} from "./utils/get-trusted-client-ip";

export {
  validateExternalUrl,
  safeFetch,
  ExternalUrlError,
  SafeFetchError,
  type ValidateExternalUrlOptions,
  type ValidatedUrl,
  type SafeFetchOptions,
} from "./utils/validate-external-url";

// ============================================================
// MEDIA VARIANT HELPERS
// ============================================================

export {
  getMediaVariant,
  getSmallestMediaVariant,
  type MediaLike,
  type GetMediaVariantOptions,
} from "./lib/media-variant";
