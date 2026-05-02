/**
 * Direct API Type Definitions — Barrel Export
 *
 * Re-exports every Direct API type from its domain module so consumers can
 * import any public type from `./direct-api/types` unchanged. See each domain
 * module for the full type inventory.
 *
 * @packageDocumentation
 */

export type {
  // Phase 4 (Task 13): canonical list / mutation shapes shared with the wire API.
  // Note: the deprecated `PaginatedDocs<T>` alias was removed in Task 23
  // after Tasks 13-21 migrated every in-tree consumer to `ListResult<T>`.
  ListResult,
  MutationResult,
  PaginationMeta,
  // Legacy Payload-style paginated shape, kept exported for callers that
  // have not migrated yet but no longer used by the Direct API itself.
  PaginatedResponse,
  WhereFilter,
  QueryOperator,
  FieldCondition,
  RichTextOutputFormat,
  GeneratedTypes,
  CollectionSlug,
  SingleSlug,
  DataFromCollectionSlug,
  DataFromSingleSlug,
  UserContext,
  RequestContext,
  DirectAPIConfig,
  PopulateOptions,
} from "./shared";

export type {
  FindArgs,
  FindByIDArgs,
  CreateArgs,
  UpdateArgs,
  DeleteArgs,
  CountArgs,
  BulkDeleteArgs,
  DuplicateArgs,
  CountResult,
  DeleteResult,
  BulkOperationResult,
} from "./collections";

export type {
  FindGlobalArgs,
  UpdateGlobalArgs,
  SingleDefinition,
  FindGlobalsArgs,
  GlobalEntry,
  SingleListResult,
} from "./singles";

export type {
  AuthArgs,
  LoginArgs,
  LogoutArgs,
  RegisterArgs,
  ChangePasswordArgs,
  ForgotPasswordArgs,
  ResetPasswordArgs,
  VerifyEmailArgs,
  UnlockArgs,
  LoginResult,
  RegisterResult,
  AuthResult,
} from "./auth";

export type {
  FindUsersArgs,
  FindOneUserArgs,
  FindUserByIDArgs,
  CreateUserArgs,
  UpdateUserArgs,
  DeleteUserArgs,
} from "./users";

export type {
  UploadFileData,
  UploadMediaArgs,
  FindMediaArgs,
  FindMediaByIDArgs,
  UpdateMediaArgs,
  DeleteMediaArgs,
  BulkDeleteMediaArgs,
  ListFoldersArgs,
  CreateFolderArgs,
} from "./media";

export type {
  FormsConfig,
  FindFormsArgs,
  FindFormBySlugArgs,
  SubmitFormArgs,
  SubmitFormResult,
  FormSubmissionsArgs,
} from "./forms";

export type {
  ComponentSlug,
  DataFromComponentSlug,
  ComponentDefinition,
  FindComponentsArgs,
  FindComponentBySlugArgs,
  CreateComponentArgs,
  UpdateComponentArgs,
  DeleteComponentArgs,
  ComponentListResult,
} from "./components";

export type {
  FindEmailProvidersArgs,
  FindEmailProviderByIDArgs,
  CreateEmailProviderArgs,
  UpdateEmailProviderArgs,
  DeleteEmailProviderArgs,
  SetDefaultProviderArgs,
  TestEmailProviderArgs,
  FindEmailTemplatesArgs,
  FindEmailTemplateByIDArgs,
  FindEmailTemplateBySlugArgs,
  CreateEmailTemplateArgs,
  UpdateEmailTemplateArgs,
  DeleteEmailTemplateArgs,
  PreviewEmailTemplateArgs,
  GetEmailLayoutArgs,
  UpdateEmailLayoutArgs,
  FindUserFieldsArgs,
  FindUserFieldByIDArgs,
  CreateUserFieldArgs,
  UpdateUserFieldArgs,
  DeleteUserFieldArgs,
  ReorderUserFieldsArgs,
  SendEmailArgs,
  SendTemplateEmailArgs,
  SendEmailResult,
} from "./email";

export type {
  ApiKeyMeta,
  ApiKeyTokenType,
  ExpiresIn,
  Role,
  Permission,
  FindRolesArgs,
  FindRoleByIDArgs,
  CreateRoleArgs,
  UpdateRoleArgs,
  DeleteRoleArgs,
  GetRolePermissionsArgs,
  SetRolePermissionsArgs,
  FindPermissionsArgs,
  FindPermissionByIDArgs,
  CreatePermissionArgs,
  DeletePermissionArgs,
  CheckAccessArgs,
  ApiKeyResult,
  ListApiKeysArgs,
  FindApiKeyByIDArgs,
  CreateApiKeyArgs,
  UpdateApiKeyArgs,
  RevokeApiKeyArgs,
  CheckApiKeyArgs,
  CheckApiKeyResult,
} from "./rbac";
