/**
 * Nextly Direct API
 *
 * The Nextly class provides direct server-side access to database operations
 * without HTTP overhead. Use it in Server Components, API routes, Server Actions,
 * and hooks.
 *
 * The Direct API provides a clean, type-safe interface for all database operations.
 *
 * Implementation note: the per-domain method bodies live under
 * `./namespaces/`. This file contains the public class surface, lazy service
 * accessors, and thin delegations to the namespace modules — keeping the
 * public API 100% backward-compatible while each domain stays small and
 * self-contained.
 *
 * @example
 * ```typescript
 * import { getNextly } from 'nextly';
 *
 * const nextly = getNextly();
 *
 * // Find documents
 * const posts = await nextly.find({
 *   collection: 'posts',
 *   where: { status: { equals: 'published' } },
 *   limit: 10,
 *   sort: '-createdAt',
 * });
 *
 * // Get single document
 * const post = await nextly.findByID({
 *   collection: 'posts',
 *   id: 'post-123',
 * });
 *
 * // Create document
 * const newPost = await nextly.create({
 *   collection: 'posts',
 *   data: { title: 'Hello', content: 'World' },
 * });
 * ```
 *
 * @packageDocumentation
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { container } from "../di/container";
import { isServicesRegistered } from "../di/register";
import { NextlyError } from "../errors/nextly-error";
import type { ApiKeyService } from "../services/auth/api-key-service";
import { AuthService } from "../services/auth/auth-service";
import { PermissionService } from "../services/auth/permission-service";
import type { RBACAccessControlService } from "../services/auth/rbac-access-control-service";
import { RolePermissionService } from "../services/auth/role-permission-service";
import { RoleService } from "../services/auth/role-service";
import type { CollectionsHandler } from "../services/collections-handler";
import type { ComponentRegistryService } from "../services/components/component-registry-service";
import type { EmailProviderService } from "../services/email/email-provider-service";
import type { EmailService } from "../services/email/email-service";
import type { EmailTemplateService } from "../services/email/email-template-service";
import type { MediaService } from "../services/media/media-service";
import type { Logger } from "../services/shared";
import type { SingleEntryService } from "../services/singles/single-entry-service";
import type { SingleRegistryService } from "../services/singles/single-registry-service";
import { UserAccountService } from "../services/users/user-account-service";
import type { UserFieldDefinitionService } from "../services/users/user-field-definition-service";
import type { UserService } from "../services/users/user-service";

import * as authNs from "./namespaces/auth";
import * as collectionsNs from "./namespaces/collections";
import type { NextlyContext } from "./namespaces/context";
import {
  createAccessNamespace,
  createApiKeysNamespace,
  createComponentsNamespace,
  createEmailNamespace,
  createEmailProvidersNamespace,
  createEmailTemplatesNamespace,
  createFormsNamespace,
  createMediaNamespace,
  createPermissionsNamespace,
  createRolesNamespace,
  createUserFieldsNamespace,
  createUsersNamespace,
  type AccessNamespace,
  type ApiKeysNamespace,
  type ComponentsNamespace,
  type EmailNamespace,
  type EmailProvidersNamespace,
  type EmailTemplatesNamespace,
  type FormsNamespace,
  type MediaNamespace,
  type PermissionsNamespace,
  type RolesNamespace,
  type UserFieldsNamespace,
  type UsersNamespace,
} from "./namespaces/index";
import * as singlesNs from "./namespaces/singles";
import type {
  AuthResult,
  BulkDeleteArgs,
  BulkOperationResult,
  ChangePasswordArgs,
  CollectionSlug,
  CountArgs,
  CountResult,
  CreateArgs,
  DataFromCollectionSlug,
  DataFromSingleSlug,
  DeleteArgs,
  DeleteResult,
  DirectAPIConfig,
  DuplicateArgs,
  FindArgs,
  FindByIDArgs,
  FindGlobalArgs,
  FindGlobalsArgs,
  ForgotPasswordArgs,
  ListResult,
  LoginArgs,
  LoginResult,
  MutationResult,
  RegisterArgs,
  ResetPasswordArgs,
  SingleListResult,
  SingleSlug,
  UpdateArgs,
  UpdateGlobalArgs,
  UserContext,
  VerifyEmailArgs,
  CheckAccessArgs,
  CheckApiKeyArgs,
  CheckApiKeyResult,
  CreateApiKeyArgs,
  CreateComponentArgs,
  CreateEmailProviderArgs,
  CreateEmailTemplateArgs,
  CreateFolderArgs,
  CreatePermissionArgs,
  CreateRoleArgs,
  CreateUserArgs,
  CreateUserFieldArgs,
  DeleteComponentArgs,
  DeleteEmailProviderArgs,
  DeleteEmailTemplateArgs,
  DeleteMediaArgs,
  DeletePermissionArgs,
  DeleteRoleArgs,
  DeleteUserArgs,
  DeleteUserFieldArgs,
  FindApiKeyByIDArgs,
  FindComponentBySlugArgs,
  FindComponentsArgs,
  FindEmailProviderByIDArgs,
  FindEmailProvidersArgs,
  FindEmailTemplateByIDArgs,
  FindEmailTemplateBySlugArgs,
  FindEmailTemplatesArgs,
  FindFormBySlugArgs,
  FindFormsArgs,
  FindMediaArgs,
  FindMediaByIDArgs,
  FindOneUserArgs,
  FindPermissionByIDArgs,
  FindPermissionsArgs,
  FindRoleByIDArgs,
  FindRolesArgs,
  FindUserByIDArgs,
  FindUserFieldByIDArgs,
  FindUserFieldsArgs,
  FindUsersArgs,
  FormSubmissionsArgs,
  GetRolePermissionsArgs,
  ListApiKeysArgs,
  ListFoldersArgs,
  BulkDeleteMediaArgs,
  PreviewEmailTemplateArgs,
  GetEmailLayoutArgs,
  UpdateEmailLayoutArgs,
  ReorderUserFieldsArgs,
  RevokeApiKeyArgs,
  SendEmailArgs,
  SendTemplateEmailArgs,
  SetDefaultProviderArgs,
  SetRolePermissionsArgs,
  SubmitFormArgs,
  TestEmailProviderArgs,
  UpdateApiKeyArgs,
  UpdateComponentArgs,
  UpdateEmailProviderArgs,
  UpdateEmailTemplateArgs,
  UpdateMediaArgs,
  UpdateRoleArgs,
  UpdateUserArgs,
  UpdateUserFieldArgs,
  UploadMediaArgs,
} from "./types/index";

/**
 * Nextly Direct API class.
 *
 * Provides direct server-side access to database operations without HTTP overhead.
 * All methods bypass HTTP and call directly into the service layer.
 *
 * **Default Behavior:**
 * - `overrideAccess: true` - Access control is bypassed by default (trusted server context)
 * - Set `overrideAccess: false` and provide `user` context to enforce access control
 *
 * @example
 * ```typescript
 * const nextly = getNextly();
 *
 * // Default: bypass access control (trusted server context)
 * const posts = await nextly.find({ collection: 'posts' });
 *
 * // Enforce access control for user-facing operations
 * const userPosts = await nextly.find({
 *   collection: 'posts',
 *   overrideAccess: false,
 *   user: { id: 'user-123', role: 'editor' },
 * });
 * ```
 */
export class Nextly implements NextlyContext {
  /**
   * Default configuration applied to all operations.
   *
   * @internal
   */
  public readonly defaultConfig: DirectAPIConfig;

  public readonly users: UsersNamespace;
  public readonly media: MediaNamespace;
  public readonly forms: FormsNamespace;
  public readonly components: ComponentsNamespace;
  public readonly email: EmailNamespace;
  public readonly emailProviders: EmailProvidersNamespace;
  public readonly emailTemplates: EmailTemplatesNamespace;
  public readonly userFields: UserFieldsNamespace;
  public readonly roles: RolesNamespace;
  public readonly permissions: PermissionsNamespace;
  public readonly access: AccessNamespace;
  public readonly apiKeys: ApiKeysNamespace;

  /**
   * Create a new Nextly instance.
   *
   * @param config - Default configuration for all operations
   */
  constructor(config: DirectAPIConfig = {}) {
    this.defaultConfig = {
      overrideAccess: true,
      ...config,
    };

    this.users = createUsersNamespace(this);
    this.media = createMediaNamespace(this);
    this.forms = createFormsNamespace(this);
    this.components = createComponentsNamespace(this);
    this.email = createEmailNamespace(this);
    this.emailProviders = createEmailProvidersNamespace(this);
    this.emailTemplates = createEmailTemplatesNamespace(this);
    this.userFields = createUserFieldsNamespace(this);
    this.roles = createRolesNamespace(this);
    this.permissions = createPermissionsNamespace(this);
    this.access = createAccessNamespace(this);
    this.apiKeys = createApiKeysNamespace(this);
  }

  /**
   * Get the forms collection slug.
   * Defaults to "forms" (matching the form builder plugin default).
   *
   * @internal
   */
  public get formsCollectionSlug(): string {
    return this.defaultConfig.forms?.collectionSlug ?? "forms";
  }

  /**
   * Get the form submissions collection slug.
   * Defaults to "form-submissions" (matching the form builder plugin default).
   *
   * @internal
   */
  public get submissionsCollectionSlug(): string {
    return (
      this.defaultConfig.forms?.submissionCollectionSlug ?? "form-submissions"
    );
  }

  /** @internal */
  public get collectionsHandler(): CollectionsHandler {
    return container.get<CollectionsHandler>("collectionsHandler");
  }

  /** @internal */
  public get singleEntryService(): SingleEntryService {
    return container.get<SingleEntryService>("singleEntryService");
  }

  /** @internal */
  public get singleRegistryService(): SingleRegistryService {
    return container.get<SingleRegistryService>("singleRegistryService");
  }

  /** Cached AuthService — not registered in the DI container. */
  private _authService: AuthService | null = null;

  /** @internal */
  public get authService(): AuthService {
    if (!this._authService) {
      const adapter = container.get<DrizzleAdapter>("adapter");
      const logger = container.has("logger")
        ? container.get<Logger>("logger")
        : (console as unknown as Logger);

      const emailService = container.has("emailService")
        ? container.get<EmailService>("emailService")
        : undefined;

      this._authService = new AuthService(adapter, logger, emailService);
    }
    return this._authService;
  }

  /** Cached UserAccountService — not registered in the DI container. */
  private _userAccountService: UserAccountService | null = null;

  /** @internal */
  public get userAccountService(): UserAccountService {
    if (!this._userAccountService) {
      const adapter = container.get<DrizzleAdapter>("adapter");
      const logger = container.has("logger")
        ? container.get<Logger>("logger")
        : (console as unknown as Logger);
      this._userAccountService = new UserAccountService(adapter, logger);
    }
    return this._userAccountService;
  }

  /** @internal */
  public get userService(): UserService {
    return container.get<UserService>("userService");
  }

  /** @internal */
  public get mediaService(): MediaService {
    return container.get<MediaService>("mediaService");
  }

  /** @internal */
  public get componentRegistryService(): ComponentRegistryService {
    return container.get<ComponentRegistryService>("componentRegistryService");
  }

  /** @internal */
  public get emailProviderService(): EmailProviderService {
    return container.get<EmailProviderService>("emailProviderService");
  }

  /** @internal */
  public get emailTemplateService(): EmailTemplateService {
    return container.get<EmailTemplateService>("emailTemplateService");
  }

  /** @internal */
  public get userFieldDefinitionService(): UserFieldDefinitionService {
    return container.get<UserFieldDefinitionService>(
      "userFieldDefinitionService"
    );
  }

  /** @internal */
  public get emailSendService(): EmailService {
    return container.get<EmailService>("emailService");
  }

  /** Cached RoleService — not registered in the DI container. */
  private _rbacRoleService: RoleService | null = null;

  /** @internal */
  public get rbacRoleService(): RoleService {
    if (!this._rbacRoleService) {
      const adapter = container.get<DrizzleAdapter>("adapter");
      const logger = container.has("logger")
        ? container.get<Logger>("logger")
        : (console as unknown as Logger);
      this._rbacRoleService = new RoleService(adapter, logger);
    }
    return this._rbacRoleService;
  }

  /** Cached PermissionService — not registered in the DI container. */
  private _rbacPermissionService: PermissionService | null = null;

  /** @internal */
  public get rbacPermissionService(): PermissionService {
    if (!this._rbacPermissionService) {
      const adapter = container.get<DrizzleAdapter>("adapter");
      const logger = container.has("logger")
        ? container.get<Logger>("logger")
        : (console as unknown as Logger);
      this._rbacPermissionService = new PermissionService(adapter, logger);
    }
    return this._rbacPermissionService;
  }

  /** Cached RolePermissionService — not registered in the DI container. */
  private _rbacRolePermissionService: RolePermissionService | null = null;

  /** @internal */
  public get rbacRolePermissionService(): RolePermissionService {
    if (!this._rbacRolePermissionService) {
      const adapter = container.get<DrizzleAdapter>("adapter");
      const logger = container.has("logger")
        ? container.get<Logger>("logger")
        : (console as unknown as Logger);
      this._rbacRolePermissionService = new RolePermissionService(
        adapter,
        logger
      );
    }
    return this._rbacRolePermissionService;
  }

  /** @internal */
  public get rbacAccessControlService(): RBACAccessControlService {
    return container.get<RBACAccessControlService>("rbacAccessControlService");
  }

  /** @internal */
  public get apiKeyService(): ApiKeyService {
    return container.get<ApiKeyService>("apiKeyService");
  }

  /**
   * Find multiple documents in a collection.
   *
   * Phase 4 (Task 13): returns the canonical `ListResult<T>` shape
   * (`{ items, meta }`). Callers migrating from `{ docs, totalDocs, ... }`:
   * `result.docs` -> `result.items`, `result.totalDocs` -> `result.meta.total`.
   *
   * @throws {NextlyError} If the operation fails
   */
  find<TSlug extends CollectionSlug>(
    args: FindArgs<TSlug>
  ): Promise<ListResult<DataFromCollectionSlug<TSlug>>> {
    return collectionsNs.find(this, args);
  }

  /**
   * Find a single document by ID. Returns `null` when not found and
   * `disableErrors` is `true`; otherwise throws.
   */
  findByID<TSlug extends CollectionSlug>(
    args: FindByIDArgs<TSlug>
  ): Promise<DataFromCollectionSlug<TSlug> | null> {
    return collectionsNs.findByID(this, args);
  }

  /**
   * Create a new document in a collection.
   *
   * Phase 4 (Task 13): returns `{ message, item }`. Callers reading the
   * created doc must read `result.item` (was a bare `T`).
   */
  create<TSlug extends CollectionSlug>(
    args: CreateArgs<TSlug>
  ): Promise<MutationResult<DataFromCollectionSlug<TSlug>>> {
    return collectionsNs.create(this, args);
  }

  /**
   * Update a document by ID or by `where` clause (returns the first match).
   *
   * Phase 4 (Task 13): returns `{ message, item }`. Callers reading the
   * updated doc must read `result.item` (was a bare `T`).
   */
  update<TSlug extends CollectionSlug>(
    args: UpdateArgs<TSlug>
  ): Promise<MutationResult<DataFromCollectionSlug<TSlug>>> {
    return collectionsNs.update(this, args);
  }

  /**
   * Delete a document by ID or by `where` clause.
   *
   * Phase 4 (Task 13): when called with `id`, returns `{ message, item }`
   * where `item` carries the deleted `id`. The bulk-by-where path still
   * returns the legacy `DeleteResult` shape (`{ deleted, ids }`) because
   * a multi-row delete cannot collapse to a single mutation envelope.
   */
  delete<TSlug extends CollectionSlug = CollectionSlug>(
    args: DeleteArgs<TSlug>
  ): Promise<MutationResult<{ id: string }> | DeleteResult> {
    return collectionsNs.deleteEntry(this, args);
  }

  /**
   * Count documents matching a query.
   *
   * Phase 4 (Task 13): returns `{ total }` (was `{ totalDocs }`).
   */
  count(args: CountArgs): Promise<CountResult> {
    return collectionsNs.count(this, args);
  }

  /** Bulk-delete multiple documents by IDs (partial success pattern). */
  bulkDelete(args: BulkDeleteArgs): Promise<BulkOperationResult> {
    return collectionsNs.bulkDelete(this, args);
  }

  /**
   * Duplicate a document (optionally applying field overrides).
   *
   * Phase 4 (Task 13): returns `{ message, item }`. Callers reading the
   * duplicated doc must read `result.item` (was a bare `T`).
   */
  duplicate<TSlug extends CollectionSlug>(
    args: DuplicateArgs<TSlug>
  ): Promise<MutationResult<DataFromCollectionSlug<TSlug>>> {
    return collectionsNs.duplicate(this, args);
  }

  /** Get a Single (global) document by slug. */
  findGlobal<TSlug extends SingleSlug>(
    args: FindGlobalArgs<TSlug>
  ): Promise<DataFromSingleSlug<TSlug>> {
    return singlesNs.findGlobal(this, args);
  }

  /** Update a Single (global) document by slug. */
  updateGlobal<TSlug extends SingleSlug>(
    args: UpdateGlobalArgs<TSlug>
  ): Promise<DataFromSingleSlug<TSlug>> {
    return singlesNs.updateGlobal(this, args);
  }

  /** Fetch the content of every registered Single. */
  findGlobals(args: FindGlobalsArgs = {}): Promise<SingleListResult> {
    return singlesNs.findGlobals(this, args);
  }

  /** Verify credentials and return a signed session token. */
  login(args: LoginArgs): Promise<LoginResult> {
    return authNs.login(this, args);
  }

  /** Logout — no-op for the Direct API (session lives in the app). */
  logout(): Promise<void> {
    return authNs.logout();
  }

  /** Fetch the current user's profile (requires explicit `user.id`). */
  me(args: { user: UserContext }): Promise<AuthResult> {
    return authNs.me(this, args);
  }

  /** Update the current user's profile (name/image only). */
  updateMe(args: {
    user: UserContext;
    data: { name?: string; image?: string };
  }): Promise<AuthResult> {
    return authNs.updateMe(this, args);
  }

  /** Register a new user with email + password. */
  register(args: RegisterArgs): Promise<{ user: Record<string, unknown> }> {
    return authNs.register(this, args);
  }

  /** Change the current user's password (requires the current password). */
  changePassword(
    args: ChangePasswordArgs & { user: UserContext }
  ): Promise<{ success: true }> {
    return authNs.changePassword(this, args);
  }

  /** Initiate password reset (always returns success to avoid leaking emails). */
  forgotPassword(
    args: ForgotPasswordArgs
  ): Promise<{ success: true; token?: string }> {
    return authNs.forgotPassword(this, args);
  }

  /** Reset a user's password using a token from `forgotPassword`. */
  resetPassword(
    args: ResetPasswordArgs
  ): Promise<{ success: true; email?: string }> {
    return authNs.resetPassword(this, args);
  }

  /** Verify a user's email using a verification token. */
  verifyEmail(
    args: VerifyEmailArgs
  ): Promise<{ success: true; email?: string }> {
    return authNs.verifyEmail(this, args);
  }
}

/**
 * Singleton Nextly instance.
 * Stored on globalThis to survive ESM module duplication in Next.js/Turbopack.
 */
const globalForDirectApi = globalThis as unknown as {
  __nextly_directApiInstance?: Nextly | null;
};

/**
 * Get the Nextly Direct API instance.
 *
 * Returns a singleton instance of the Nextly class for direct server-side
 * database operations.
 *
 * **Important:** `registerServices()` must be called before using this function.
 *
 * @param config - Optional configuration to apply to new instance
 * @returns Nextly instance
 * @throws {NextlyError} If services are not registered
 *
 * @example
 * ```typescript
 * import { getNextly } from 'nextly';
 *
 * const nextly = getNextly();
 *
 * // Find posts
 * const posts = await nextly.find({
 *   collection: 'posts',
 *   where: { status: { equals: 'published' } },
 * });
 * // Phase 4 (Task 13): returns { items, meta }. See ListResult.
 * ```
 */
export function getNextly(config?: DirectAPIConfig): Nextly {
  if (!isServicesRegistered()) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage:
        "Nextly services not initialized. Call registerServices() before using the Direct API.",
      statusCode: 500,
    });
  }

  if (!globalForDirectApi.__nextly_directApiInstance) {
    globalForDirectApi.__nextly_directApiInstance = new Nextly(config);
    // Uses register() (not registerSingleton) so the factory always returns the current
    // globalThis instance — important for resetNextlyInstance() in testing.
    if (!container.has("nextlyDirectAPI")) {
      container.register(
        "nextlyDirectAPI",
        () => globalForDirectApi.__nextly_directApiInstance!
      );
    }
  }

  return globalForDirectApi.__nextly_directApiInstance;
}

/**
 * Reset the Nextly singleton instance.
 *
 * Primarily used for testing to ensure a fresh instance.
 *
 * @internal
 */
export function resetNextlyInstance(): void {
  globalForDirectApi.__nextly_directApiInstance = null;
}

/**
 * Module-level convenience object for Direct API operations.
 *
 * Each method lazily resolves the Nextly singleton on first call,
 * so it's safe to import at module scope. All methods delegate to
 * `getNextly()` internally.
 *
 * **Important:** Services must be initialized (via `getNextly()` from
 * `@revnixhq/nextly`) before calling any method on this object.
 *
 * @example
 * ```typescript
 * import { nextly } from '@revnixhq/nextly';
 *
 * const posts = await nextly.find({
 *   collection: 'posts',
 *   where: { status: { equals: 'published' } },
 *   limit: 10,
 *   sort: '-createdAt',
 * });
 * ```
 */
export const nextly = {
  find: <TSlug extends CollectionSlug>(args: FindArgs<TSlug>) =>
    getNextly().find(args),
  findByID: <TSlug extends CollectionSlug>(args: FindByIDArgs<TSlug>) =>
    getNextly().findByID(args),
  create: <TSlug extends CollectionSlug>(args: CreateArgs<TSlug>) =>
    getNextly().create(args),
  update: <TSlug extends CollectionSlug>(args: UpdateArgs<TSlug>) =>
    getNextly().update(args),
  delete: (args: DeleteArgs) => getNextly().delete(args),
  count: (args: CountArgs) => getNextly().count(args),
  bulkDelete: (args: BulkDeleteArgs) => getNextly().bulkDelete(args),
  duplicate: <TSlug extends CollectionSlug>(args: DuplicateArgs<TSlug>) =>
    getNextly().duplicate(args),

  findGlobal: <TSlug extends SingleSlug>(args: FindGlobalArgs<TSlug>) =>
    getNextly().findGlobal(args),
  updateGlobal: <TSlug extends SingleSlug>(args: UpdateGlobalArgs<TSlug>) =>
    getNextly().updateGlobal(args),
  findGlobals: (args?: FindGlobalsArgs) => getNextly().findGlobals(args ?? {}),

  login: (args: LoginArgs) => getNextly().login(args),
  logout: () => getNextly().logout(),
  me: (args: { user: UserContext }) => getNextly().me(args),
  updateMe: (args: {
    user: UserContext;
    data: { name?: string; image?: string };
  }) => getNextly().updateMe(args),
  register: (args: RegisterArgs) => getNextly().register(args),
  changePassword: (args: ChangePasswordArgs & { user: UserContext }) =>
    getNextly().changePassword(args),
  forgotPassword: (args: ForgotPasswordArgs) =>
    getNextly().forgotPassword(args),
  resetPassword: (args: ResetPasswordArgs) => getNextly().resetPassword(args),
  verifyEmail: (args: VerifyEmailArgs) => getNextly().verifyEmail(args),

  users: {
    find: (args?: FindUsersArgs) => getNextly().users.find(args),
    findOne: (args?: FindOneUserArgs) => getNextly().users.findOne(args),
    findByID: (args: FindUserByIDArgs) => getNextly().users.findByID(args),
    create: (args: CreateUserArgs) => getNextly().users.create(args),
    update: (args: UpdateUserArgs) => getNextly().users.update(args),
    delete: (args: DeleteUserArgs) => getNextly().users.delete(args),
  },

  media: {
    upload: (args: UploadMediaArgs) => getNextly().media.upload(args),
    find: (args?: FindMediaArgs) => getNextly().media.find(args),
    findByID: (args: FindMediaByIDArgs) => getNextly().media.findByID(args),
    update: (args: UpdateMediaArgs) => getNextly().media.update(args),
    delete: (args: DeleteMediaArgs) => getNextly().media.delete(args),
    bulkDelete: (args: BulkDeleteMediaArgs) =>
      getNextly().media.bulkDelete(args),
    folders: {
      list: (args?: ListFoldersArgs) => getNextly().media.folders.list(args),
      create: (args: CreateFolderArgs) =>
        getNextly().media.folders.create(args),
    },
  },

  forms: {
    find: (args?: FindFormsArgs) => getNextly().forms.find(args),
    findBySlug: (args: FindFormBySlugArgs) =>
      getNextly().forms.findBySlug(args),
    submit: (args: SubmitFormArgs) => getNextly().forms.submit(args),
    submissions: (args: FormSubmissionsArgs) =>
      getNextly().forms.submissions(args),
  },

  components: {
    find: (args?: FindComponentsArgs) => getNextly().components.find(args),
    findBySlug: (args: FindComponentBySlugArgs) =>
      getNextly().components.findBySlug(args),
    create: (args: CreateComponentArgs) => getNextly().components.create(args),
    update: (args: UpdateComponentArgs) => getNextly().components.update(args),
    delete: (args: DeleteComponentArgs) => getNextly().components.delete(args),
  },

  email: {
    send: (args: SendEmailArgs) => getNextly().email.send(args),
    sendWithTemplate: (args: SendTemplateEmailArgs) =>
      getNextly().email.sendWithTemplate(args),
  },

  emailProviders: {
    find: (args?: FindEmailProvidersArgs) =>
      getNextly().emailProviders.find(args),
    findByID: (args: FindEmailProviderByIDArgs) =>
      getNextly().emailProviders.findByID(args),
    create: (args: CreateEmailProviderArgs) =>
      getNextly().emailProviders.create(args),
    update: (args: UpdateEmailProviderArgs) =>
      getNextly().emailProviders.update(args),
    delete: (args: DeleteEmailProviderArgs) =>
      getNextly().emailProviders.delete(args),
    setDefault: (args: SetDefaultProviderArgs) =>
      getNextly().emailProviders.setDefault(args),
    test: (args: TestEmailProviderArgs) =>
      getNextly().emailProviders.test(args),
  },

  emailTemplates: {
    find: (args?: FindEmailTemplatesArgs) =>
      getNextly().emailTemplates.find(args),
    findByID: (args: FindEmailTemplateByIDArgs) =>
      getNextly().emailTemplates.findByID(args),
    findBySlug: (args: FindEmailTemplateBySlugArgs) =>
      getNextly().emailTemplates.findBySlug(args),
    create: (args: CreateEmailTemplateArgs) =>
      getNextly().emailTemplates.create(args),
    update: (args: UpdateEmailTemplateArgs) =>
      getNextly().emailTemplates.update(args),
    delete: (args: DeleteEmailTemplateArgs) =>
      getNextly().emailTemplates.delete(args),
    preview: (args: PreviewEmailTemplateArgs) =>
      getNextly().emailTemplates.preview(args),
    getLayout: (args?: GetEmailLayoutArgs) =>
      getNextly().emailTemplates.getLayout(args),
    updateLayout: (args: UpdateEmailLayoutArgs) =>
      getNextly().emailTemplates.updateLayout(args),
  },

  userFields: {
    find: (args?: FindUserFieldsArgs) => getNextly().userFields.find(args),
    findByID: (args: FindUserFieldByIDArgs) =>
      getNextly().userFields.findByID(args),
    create: (args: CreateUserFieldArgs) => getNextly().userFields.create(args),
    update: (args: UpdateUserFieldArgs) => getNextly().userFields.update(args),
    delete: (args: DeleteUserFieldArgs) => getNextly().userFields.delete(args),
    reorder: (args: ReorderUserFieldsArgs) =>
      getNextly().userFields.reorder(args),
  },

  roles: {
    find: (args?: FindRolesArgs) => getNextly().roles.find(args),
    findByID: (args: FindRoleByIDArgs) => getNextly().roles.findByID(args),
    create: (args: CreateRoleArgs) => getNextly().roles.create(args),
    update: (args: UpdateRoleArgs) => getNextly().roles.update(args),
    delete: (args: DeleteRoleArgs) => getNextly().roles.delete(args),
    getPermissions: (args: GetRolePermissionsArgs) =>
      getNextly().roles.getPermissions(args),
    setPermissions: (args: SetRolePermissionsArgs) =>
      getNextly().roles.setPermissions(args),
  },

  permissions: {
    find: (args?: FindPermissionsArgs) => getNextly().permissions.find(args),
    findByID: (args: FindPermissionByIDArgs) =>
      getNextly().permissions.findByID(args),
    create: (args: CreatePermissionArgs) =>
      getNextly().permissions.create(args),
    delete: (args: DeletePermissionArgs) =>
      getNextly().permissions.delete(args),
  },

  apiKeys: {
    list: (args?: ListApiKeysArgs) => getNextly().apiKeys.list(args),
    findByID: (args: FindApiKeyByIDArgs) => getNextly().apiKeys.findByID(args),
    create: (args: CreateApiKeyArgs) => getNextly().apiKeys.create(args),
    update: (args: UpdateApiKeyArgs) => getNextly().apiKeys.update(args),
    revoke: (args: RevokeApiKeyArgs) => getNextly().apiKeys.revoke(args),
  },

  access: {
    check: (args: CheckAccessArgs) => getNextly().access.check(args),
    checkApiKey: (args: CheckApiKeyArgs) =>
      getNextly().access.checkApiKey(args),
  },
};
