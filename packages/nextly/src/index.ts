// Release-pipeline test (0.0.136): verifies the consolidated v0.0.X
// GitHub Release workflow introduced in #1243. No runtime impact.

// IMPORTANT (task 24 stage 1): this root entry is the Node-safe surface
// of @revnixhq/nextly. Anything that statically imports `next/navigation`,
// `next/cache`, `next/headers`, etc. lives behind the
// `@revnixhq/nextly/runtime` subpath instead. Keeping the root clean is
// what lets the CLI, plugin authors, and config loaders import from
// the package without dragging Next.js into a Node-only context.
//
// If you find yourself wanting to add a re-export here that pulls
// `routeHandler.ts`, `api/with-error-handler.ts`, `actions/with-action.ts`,
// `actions/upload-media.ts`, or anything reachable from those files —
// move it under `runtime.ts` (which is exported from the
// `@revnixhq/nextly/runtime` subpath) and update consumers there.
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
// DATABASE ADAPTER TYPES (Plan 03)
// ============================================================

// Re-export common types from @revnixhq/adapter-drizzle for convenience.
// Users can import these directly from '@revnixhq/nextly' instead of separate packages.

// DrizzleAdapter class (for extending or type checking)
export { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

// Common adapter types
export type {
  DatabaseCapabilities,
  TransactionContext,
  WhereClause,
  SelectOptions,
} from "@revnixhq/adapter-drizzle/types";

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
// DIRECT API (Plan 10)
// ============================================================

// Convenience object - lazily delegates to the Direct API singleton.
// Import and use directly: `import { nextly } from '@revnixhq/nextly'`
export { nextly } from "./direct-api";

// Canonical NextlyError — re-exported here for ergonomic catch-block use.
// For richer surface (codes, public-data types, etc.) import from
// `@revnixhq/nextly/errors`. Use the static type guards on `NextlyError`
// (e.g. `NextlyError.isNotFound(err)`) — the legacy `is*Error` helpers
// were removed in PR 12 (final unified-error-system cleanup).
export { NextlyError } from "./errors";

// Direct API types - type-safe slug resolution (for generated types integration)
export type {
  GeneratedTypes,
  CollectionSlug,
  SingleSlug,
  DataFromCollectionSlug,
  DataFromSingleSlug,
} from "./direct-api/types";

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
  FindGlobalArgs,
  UpdateGlobalArgs,
  CountResult,
  DeleteResult,
  BulkOperationResult as DirectAPIBulkOperationResult,
  // Phase 4 (Task 13): canonical envelope shapes shared with the wire API.
  // Templates and downstream consumers import these to type Direct API
  // results without reaching into internal modules. The deprecated
  // `PaginatedDocs<T>` alias was removed in Task 23 once Tasks 13-21
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
  GetEmailLayoutArgs,
  UpdateEmailLayoutArgs,
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
  GeneratedTypesFile,
} from "./domains/schema/services/type-generator";

// ============================================================
// ADVANCED DI API (for power users)
// ============================================================

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
// NEW SERVICE LAYER EXPORTS (Plan 02)
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

// Plugin System - Types and helpers for creating plugins
export {
  AdminPlacement,
  definePlugin,
  createPluginContext,
  type PluginAdminAppearance,
  type PluginAdminConfig,
  type PluginContext,
  type PluginDefinition,
  type PluginHookRegistry,
} from "./plugins";

// ============================================================
// COLLECTIONS & FIELD TYPES (Plan 04)
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
// MIDDLEWARE (Plan 05 - Phase 9)
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

// Security middleware types (Plan 15)
export { type SecurityHeadersConfig, type CorsConfig } from "./middleware";

// ============================================================
// SINGLES (Plan 06)
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
// COMPONENTS (Plan 11)
// ============================================================

// Component configuration (defineComponent, ComponentConfig, etc.)
export {
  defineComponent,
  type ComponentConfig,
  type ComponentLabel,
  type ComponentAdminOptions,
} from "./components";

// Component configuration validation
export {
  validateComponentConfig,
  assertValidComponentConfig,
  type ComponentValidationResult,
  type ComponentValidationError,
  type ComponentValidationErrorCode,
  RESERVED_COMPONENT_SLUGS,
  MAX_COMPONENT_NESTING_DEPTH,
} from "./components";

// Component field type (also exported from ./collections/fields via barrel export)
export type { ComponentFieldConfig } from "./collections/fields/types/component";

// ============================================================
// USER MANAGEMENT (Plan 12)
// ============================================================

// User configuration
export type {
  UserConfig,
  UserFieldConfig,
  UserFieldType,
  UserAdminOptions,
} from "./users";

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
// RBAC & ACCESS CONTROL (Plan 13)
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
// API KEY AUTHENTICATION (Plan 14)
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
  type ValidateExternalUrlOptions,
  type ValidatedUrl,
  type SafeFetchOptions,
} from "./utils/validate-external-url";
