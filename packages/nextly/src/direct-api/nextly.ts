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
 * import { requireNextly } from 'nextly/runtime';
 *
 * const nextly = requireNextly();
 *
 * // Find documents -> ListResult<T> = { items, meta }
 * const result = await nextly.find({
 *   collection: 'posts',
 *   where: { status: { equals: 'published' } },
 *   limit: 10,
 *   sort: '-createdAt',
 * });
 * result.items;       // Post[]
 * result.meta.total;  // number
 *
 * // Get single document -> bare doc or null
 * const post = await nextly.findByID({
 *   collection: 'posts',
 *   id: 'post-123',
 * });
 *
 * // Create document -> MutationResult<T> = { message, item }
 * const created = await nextly.create({
 *   collection: 'posts',
 *   data: { title: 'Hello', content: 'World' },
 * });
 * created.item;     // Post
 * created.message;  // string
 * ```
 *
 * @packageDocumentation
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../di/container";
import { isServicesRegistered } from "../di/register";
import type { ApiKeyService } from "../domains/auth/services/api-key-service";
import { AuthService } from "../domains/auth/services/auth-service";
import { PermissionService } from "../domains/auth/services/permission-service";
import type { RBACAccessControlService } from "../domains/auth/services/rbac-access-control-service";
import { RolePermissionService } from "../domains/auth/services/role-permission-service";
import { RoleService } from "../domains/auth/services/role-service";
import type { FieldGroupMetadataService } from "../domains/field-groups/services/field-group-metadata-service";
import { NextlyError } from "../errors/nextly-error";
import { assertBootMigrationsSettled } from "../init/boot-migrations-gate";
import { buildPluginServicesNamespace } from "../plugins/services/plugin-services-registry";
import type { CollectionsHandler } from "../services/collections-handler";
import type { EmailProviderService } from "../services/email/email-provider-service";
import type { EmailService } from "../services/email/email-service";
import type { EmailTemplateService } from "../services/email/email-template-service";
import type { FieldGroupRegistryService } from "../services/field-groups/field-group-registry-service";
import type { MediaService } from "../services/media/media-service";
import type { Logger } from "../services/shared";
import type { SingleEntryService } from "../services/singles/single-entry-service";
import type { SingleRegistryService } from "../services/singles/single-registry-service";
import { UserAccountService } from "../services/users/user-account-service";
import type { UserFieldDefinitionService } from "../services/users/user-field-definition-service";
import type { UserService } from "../services/users/user-service";

import { installLegacyFieldGroupsNamespaceGuard } from "./legacy-field-groups-namespace";
import * as authNs from "./namespaces/auth";
import * as collectionsNs from "./namespaces/collections";
import type { NextlyContext } from "./namespaces/context";
import {
  createAccessNamespace,
  createApiKeysNamespace,
  createJobsNamespace,
  createReleasesNamespace,
  createFieldGroupsNamespace,
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
  type JobsNamespace,
  type ReleasesNamespace,
  type FieldGroupsNamespace,
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
  GroupArgs,
  GroupResult,
  CreateArgs,
  RowFromCollectionSlug,
  RowFromSingleSlug,
  DeleteArgs,
  DeleteResult,
  DirectAPIConfig,
  DuplicateArgs,
  FindArgs,
  FindByIDArgs,
  FindSingleArgs,
  FindSinglesArgs,
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
  UpdateSingleArgs,
  UserContext,
  VerifyEmailArgs,
  CheckAccessArgs,
  CheckApiKeyArgs,
  CreateApiKeyArgs,
  CreateFieldGroupArgs,
  CreateEmailProviderArgs,
  CreateEmailTemplateArgs,
  CreateFolderArgs,
  CreatePermissionArgs,
  CreateRoleArgs,
  CreateUserArgs,
  CreateUserFieldArgs,
  DeleteFieldGroupArgs,
  DeleteEmailProviderArgs,
  DeleteEmailTemplateArgs,
  DeleteMediaArgs,
  DeletePermissionArgs,
  DeleteRoleArgs,
  DeleteUserArgs,
  DeleteUserFieldArgs,
  FindApiKeyByIDArgs,
  FindFieldGroupBySlugArgs,
  FindFieldGroupsArgs,
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
  ReorderUserFieldsArgs,
  RevokeApiKeyArgs,
  SendEmailArgs,
  SendTemplateEmailArgs,
  SetDefaultProviderArgs,
  SetRolePermissionsArgs,
  SubmitFormArgs,
  TestEmailProviderArgs,
  UpdateApiKeyArgs,
  UpdateFieldGroupArgs,
  UpdateEmailProviderArgs,
  UpdateEmailTemplateArgs,
  UpdateMediaArgs,
  UpdateRoleArgs,
  UpdateUserArgs,
  UpdateUserFieldArgs,
  UploadMediaArgs,
} from "./types/index";
import type { JobSlug, QueueJobArgs } from "./types/jobs";

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
 * const nextly = requireNextly();
 *
 * // Default: bypass access control (trusted server context)
 * // Returns ListResult<T> = { items, meta }.
 * const posts = await nextly.find({ collection: 'posts' });
 * posts.items;       // Post[]
 * posts.meta.total;  // number
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
  public readonly fieldGroups: FieldGroupsNamespace;
  public readonly email: EmailNamespace;
  public readonly emailProviders: EmailProvidersNamespace;
  public readonly emailTemplates: EmailTemplatesNamespace;
  public readonly userFields: UserFieldsNamespace;
  public readonly roles: RolesNamespace;
  public readonly permissions: PermissionsNamespace;
  public readonly access: AccessNamespace;
  public readonly apiKeys: ApiKeysNamespace;
  public readonly jobs: JobsNamespace;
  public readonly releases: ReleasesNamespace;

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
    this.fieldGroups = createFieldGroupsNamespace(this);
    this.email = createEmailNamespace(this);
    this.emailProviders = createEmailProvidersNamespace(this);
    this.emailTemplates = createEmailTemplatesNamespace(this);
    this.userFields = createUserFieldsNamespace(this);
    this.roles = createRolesNamespace(this);
    this.permissions = createPermissionsNamespace(this);
    this.access = createAccessNamespace(this);
    this.apiKeys = createApiKeysNamespace(this);
    this.jobs = createJobsNamespace();
    this.releases = createReleasesNamespace(this);
  }

  /**
   * @experimental In-process access to plugin-contributed services (D66), keyed
   * by plugin name then service name — the same registry exposed to plugins as
   * `ctx.services.plugins`. Lazily resolved (instantiated on first access). Cast
   * to your service's type, or import it from the providing plugin.
   */
  public get plugins(): Record<string, Record<string, unknown>> {
    return buildPluginServicesNamespace();
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
  public get fieldGroupRegistryService(): FieldGroupRegistryService {
    return container.get<FieldGroupRegistryService>(
      "fieldGroupRegistryService"
    );
  }

  /** @internal */
  public get fieldGroupMetadataService(): FieldGroupMetadataService {
    return container.get<FieldGroupMetadataService>(
      "fieldGroupMetadataService"
    );
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
   * (`{ items, meta }`). Callers migrating from `{ docs, totalDocs, ... }`:
   * `result.docs` -> `result.items`, `result.totalDocs` -> `result.meta.total`.
   *
   * @throws {NextlyError} If the operation fails
   */
  find<TSlug extends CollectionSlug>(
    args: FindArgs<TSlug>
  ): Promise<ListResult<RowFromCollectionSlug<TSlug>>> {
    return collectionsNs.find(this, args);
  }

  /**
   * Find a single document by ID. Returns `null` when not found and
   * `disableErrors` is `true`; otherwise throws.
   */
  findByID<TSlug extends CollectionSlug>(
    args: FindByIDArgs<TSlug>
  ): Promise<RowFromCollectionSlug<TSlug> | null> {
    return collectionsNs.findByID(this, args);
  }

  /**
   * Create a new document in a collection.
   *
   * created doc must read `result.item` (was a bare `T`).
   */
  create<TSlug extends CollectionSlug>(
    args: CreateArgs<TSlug>
  ): Promise<MutationResult<RowFromCollectionSlug<TSlug>>> {
    return collectionsNs.create(this, args);
  }

  /**
   * Update a document by ID or by `where` clause (returns the first match).
   *
   * updated doc must read `result.item` (was a bare `T`).
   */
  update<TSlug extends CollectionSlug>(
    args: UpdateArgs<TSlug>
  ): Promise<MutationResult<RowFromCollectionSlug<TSlug>>> {
    return collectionsNs.update(this, args);
  }

  /**
   * Delete a document by ID or by `where` clause.
   *
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
   */
  count(args: CountArgs): Promise<CountResult> {
    return collectionsNs.count(this, args);
  }

  /**
   * How many documents carry each distinct value of one field.
   *
   * Answers over the rows a `count` with the same arguments would have
   * counted, because both resolve that row set through one pipeline.
   */
  group(args: GroupArgs): Promise<GroupResult> {
    return collectionsNs.group(this, args);
  }

  /** Bulk-delete multiple documents by IDs (partial success pattern). */
  bulkDelete(args: BulkDeleteArgs): Promise<BulkOperationResult> {
    return collectionsNs.bulkDelete(this, args);
  }

  /**
   * Duplicate a document (optionally applying field overrides).
   *
   * duplicated doc must read `result.item` (was a bare `T`).
   */
  duplicate<TSlug extends CollectionSlug>(
    args: DuplicateArgs<TSlug>
  ): Promise<MutationResult<RowFromCollectionSlug<TSlug>>> {
    return collectionsNs.duplicate(this, args);
  }

  /** Get a Single (global) document by slug. */
  findSingle<TSlug extends SingleSlug>(
    args: FindSingleArgs<TSlug>
  ): Promise<RowFromSingleSlug<TSlug>> {
    return singlesNs.findSingle(this, args);
  }

  /**
   * Update a Single (global) document by slug.
   *
   * Returns the same `{ message, item }` envelope the collection mutations do,
   * so every mutation reports its outcome the same way and a post-commit hook
   * failure has somewhere to be reported.
   */
  updateSingle<TSlug extends SingleSlug>(
    args: UpdateSingleArgs<TSlug>
  ): Promise<MutationResult<RowFromSingleSlug<TSlug>>> {
    return singlesNs.updateSingle(this, args);
  }

  /** Fetch the content of every registered Single. */
  findSingles(args: FindSinglesArgs = {}): Promise<SingleListResult> {
    return singlesNs.findSingles(this, args);
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
 * The Nextly instance this process has already registered.
 *
 * Named for what it demands rather than what it returns. It does NOT
 * initialise: it reads the singleton and throws when there is none, so it is
 * only correct where something else has provably booted the runtime. Where you
 * are not sure, `getNextly({ config })` from `nextly` initialises and is
 * correct in both cases.
 *
 * That difference is why the two no longer share a name. Both were called
 * `getNextly`, one exported from `nextly` and one from `nextly/runtime`, with
 * different arities, different return types and opposite tolerance for an
 * uninitialised process. The example on this function even told readers to
 * import it from `nextly`, where the name resolves to the other one, so the
 * snippet could not compile.
 *
 * **Important:** `registerServices()` must have run before this is called.
 *
 * @param config - Optional configuration to apply to new instance
 * @returns Nextly instance
 * @throws {NextlyError} If services are not registered
 *
 * @example
 * ```typescript
 * import { requireNextly } from 'nextly/runtime';
 *
 * const nextly = requireNextly();
 *
 * // Find posts. Returns ListResult<T> = { items, meta }.
 * const result = await nextly.find({
 *   collection: 'posts',
 *   where: { status: { equals: 'published' } },
 * });
 * result.items;       // Post[]
 * result.meta.total;  // number
 * ```
 */
export function requireNextly(config?: DirectAPIConfig): Nextly {
  // Registration is not readiness. A production boot publishes services and
  // THEN waits for the migrate lock, so this flag is true throughout a window
  // in which the schema is unverified — and this getter is synchronous, so it
  // cannot wait for the answer the way the async surfaces do.
  assertBootMigrationsSettled();

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
 * Whether the Direct API singleton has been built in this process.
 *
 * Answers the question without building it, which `requireNextly()` cannot: asking
 * it constructs the instance and registers the container binding. That makes
 * "was the Direct API resolved?" unobservable through the ordinary surface, so
 * a test cannot tell a caller that resolved it lazily from one that never
 * touched it at all.
 *
 * @internal
 */
export function isNextlyInstantiated(): boolean {
  return Boolean(globalForDirectApi.__nextly_directApiInstance);
}

/**
 * Module-level convenience object for Direct API operations.
 *
 * Each method lazily resolves the Nextly singleton on first call,
 * so it's safe to import at module scope. All methods delegate to
 * `requireNextly()` internally.
 *
 * **Important:** the runtime must already be initialised before any method on
 * this object is called, because each one resolves through `requireNextly()`,
 * which throws when nothing has registered services. `getNextly({ config })`
 * from `nextly` is what initialises.
 *
 * @example
 * ```typescript
 * import { nextly } from 'nextly';
 *
 * // Returns ListResult<T> = { items, meta }.
 * const result = await nextly.find({
 *   collection: 'posts',
 *   where: { status: { equals: 'published' } },
 *   limit: 10,
 *   sort: '-createdAt',
 * });
 * result.items;       // Post[]
 * result.meta.total;  // number
 * ```
 */
export const nextly = {
  find: <TSlug extends CollectionSlug>(args: FindArgs<TSlug>) =>
    requireNextly().find(args),
  findByID: <TSlug extends CollectionSlug>(args: FindByIDArgs<TSlug>) =>
    requireNextly().findByID(args),
  create: <TSlug extends CollectionSlug>(args: CreateArgs<TSlug>) =>
    requireNextly().create(args),
  update: <TSlug extends CollectionSlug>(args: UpdateArgs<TSlug>) =>
    requireNextly().update(args),
  delete: (args: DeleteArgs) => requireNextly().delete(args),
  count: (args: CountArgs) => requireNextly().count(args),
  group: (args: GroupArgs) => requireNextly().group(args),
  bulkDelete: (args: BulkDeleteArgs) => requireNextly().bulkDelete(args),
  duplicate: <TSlug extends CollectionSlug>(args: DuplicateArgs<TSlug>) =>
    requireNextly().duplicate(args),

  findSingle: <TSlug extends SingleSlug>(args: FindSingleArgs<TSlug>) =>
    requireNextly().findSingle(args),
  updateSingle: <TSlug extends SingleSlug>(args: UpdateSingleArgs<TSlug>) =>
    requireNextly().updateSingle(args),
  findSingles: (args?: FindSinglesArgs) =>
    requireNextly().findSingles(args ?? {}),

  login: (args: LoginArgs) => requireNextly().login(args),
  logout: () => requireNextly().logout(),
  me: (args: { user: UserContext }) => requireNextly().me(args),
  updateMe: (args: {
    user: UserContext;
    data: { name?: string; image?: string };
  }) => requireNextly().updateMe(args),
  register: (args: RegisterArgs) => requireNextly().register(args),
  changePassword: (args: ChangePasswordArgs & { user: UserContext }) =>
    requireNextly().changePassword(args),
  forgotPassword: (args: ForgotPasswordArgs) =>
    requireNextly().forgotPassword(args),
  resetPassword: (args: ResetPasswordArgs) =>
    requireNextly().resetPassword(args),
  verifyEmail: (args: VerifyEmailArgs) => requireNextly().verifyEmail(args),

  jobs: {
    queue: <TTask extends JobSlug>(args: QueueJobArgs<TTask>) =>
      requireNextly().jobs.queue(args),
  },

  releases: {
    create: (args: Parameters<ReleasesNamespace["create"]>[0]) =>
      requireNextly().releases.create(args),
    find: (args?: Parameters<ReleasesNamespace["find"]>[0]) =>
      requireNextly().releases.find(args),
    findByID: (args: Parameters<ReleasesNamespace["findByID"]>[0]) =>
      requireNextly().releases.findByID(args),
    addMember: (args: Parameters<ReleasesNamespace["addMember"]>[0]) =>
      requireNextly().releases.addMember(args),
    removeMember: (args: Parameters<ReleasesNamespace["removeMember"]>[0]) =>
      requireNextly().releases.removeMember(args),
    listMembers: (args: Parameters<ReleasesNamespace["listMembers"]>[0]) =>
      requireNextly().releases.listMembers(args),
    schedule: (args: Parameters<ReleasesNamespace["schedule"]>[0]) =>
      requireNextly().releases.schedule(args),
    cancel: (args: Parameters<ReleasesNamespace["cancel"]>[0]) =>
      requireNextly().releases.cancel(args),
  },

  users: {
    find: (args?: FindUsersArgs) => requireNextly().users.find(args),
    findOne: (args?: FindOneUserArgs) => requireNextly().users.findOne(args),
    findByID: (args: FindUserByIDArgs) => requireNextly().users.findByID(args),
    create: (args: CreateUserArgs) => requireNextly().users.create(args),
    update: (args: UpdateUserArgs) => requireNextly().users.update(args),
    delete: (args: DeleteUserArgs) => requireNextly().users.delete(args),
  },

  media: {
    upload: (args: UploadMediaArgs) => requireNextly().media.upload(args),
    find: (args?: FindMediaArgs) => requireNextly().media.find(args),
    findByID: (args: FindMediaByIDArgs) => requireNextly().media.findByID(args),
    update: (args: UpdateMediaArgs) => requireNextly().media.update(args),
    delete: (args: DeleteMediaArgs) => requireNextly().media.delete(args),
    bulkDelete: (args: BulkDeleteMediaArgs) =>
      requireNextly().media.bulkDelete(args),
    folders: {
      list: (args?: ListFoldersArgs) =>
        requireNextly().media.folders.list(args),
      create: (args: CreateFolderArgs) =>
        requireNextly().media.folders.create(args),
    },
  },

  forms: {
    find: (args?: FindFormsArgs) => requireNextly().forms.find(args),
    findBySlug: (args: FindFormBySlugArgs) =>
      requireNextly().forms.findBySlug(args),
    submit: (args: SubmitFormArgs) => requireNextly().forms.submit(args),
    submissions: (args: FormSubmissionsArgs) =>
      requireNextly().forms.submissions(args),
  },

  fieldGroups: {
    find: (args?: FindFieldGroupsArgs) =>
      requireNextly().fieldGroups.find(args),
    findBySlug: (args: FindFieldGroupBySlugArgs) =>
      requireNextly().fieldGroups.findBySlug(args),
    create: (args: CreateFieldGroupArgs) =>
      requireNextly().fieldGroups.create(args),
    update: (args: UpdateFieldGroupArgs) =>
      requireNextly().fieldGroups.update(args),
    delete: (args: DeleteFieldGroupArgs) =>
      requireNextly().fieldGroups.delete(args),
  },

  email: {
    send: (args: SendEmailArgs) => requireNextly().email.send(args),
    sendWithTemplate: (args: SendTemplateEmailArgs) =>
      requireNextly().email.sendWithTemplate(args),
  },

  emailProviders: {
    find: (args?: FindEmailProvidersArgs) =>
      requireNextly().emailProviders.find(args),
    findByID: (args: FindEmailProviderByIDArgs) =>
      requireNextly().emailProviders.findByID(args),
    create: (args: CreateEmailProviderArgs) =>
      requireNextly().emailProviders.create(args),
    update: (args: UpdateEmailProviderArgs) =>
      requireNextly().emailProviders.update(args),
    delete: (args: DeleteEmailProviderArgs) =>
      requireNextly().emailProviders.delete(args),
    setDefault: (args: SetDefaultProviderArgs) =>
      requireNextly().emailProviders.setDefault(args),
    test: (args: TestEmailProviderArgs) =>
      requireNextly().emailProviders.test(args),
  },

  emailTemplates: {
    find: (args?: FindEmailTemplatesArgs) =>
      requireNextly().emailTemplates.find(args),
    findByID: (args: FindEmailTemplateByIDArgs) =>
      requireNextly().emailTemplates.findByID(args),
    findBySlug: (args: FindEmailTemplateBySlugArgs) =>
      requireNextly().emailTemplates.findBySlug(args),
    create: (args: CreateEmailTemplateArgs) =>
      requireNextly().emailTemplates.create(args),
    update: (args: UpdateEmailTemplateArgs) =>
      requireNextly().emailTemplates.update(args),
    delete: (args: DeleteEmailTemplateArgs) =>
      requireNextly().emailTemplates.delete(args),
    preview: (args: PreviewEmailTemplateArgs) =>
      requireNextly().emailTemplates.preview(args),
  },

  userFields: {
    find: (args?: FindUserFieldsArgs) => requireNextly().userFields.find(args),
    findByID: (args: FindUserFieldByIDArgs) =>
      requireNextly().userFields.findByID(args),
    create: (args: CreateUserFieldArgs) =>
      requireNextly().userFields.create(args),
    update: (args: UpdateUserFieldArgs) =>
      requireNextly().userFields.update(args),
    delete: (args: DeleteUserFieldArgs) =>
      requireNextly().userFields.delete(args),
    reorder: (args: ReorderUserFieldsArgs) =>
      requireNextly().userFields.reorder(args),
  },

  roles: {
    find: (args?: FindRolesArgs) => requireNextly().roles.find(args),
    findByID: (args: FindRoleByIDArgs) => requireNextly().roles.findByID(args),
    create: (args: CreateRoleArgs) => requireNextly().roles.create(args),
    update: (args: UpdateRoleArgs) => requireNextly().roles.update(args),
    delete: (args: DeleteRoleArgs) => requireNextly().roles.delete(args),
    getPermissions: (args: GetRolePermissionsArgs) =>
      requireNextly().roles.getPermissions(args),
    setPermissions: (args: SetRolePermissionsArgs) =>
      requireNextly().roles.setPermissions(args),
  },

  permissions: {
    find: (args?: FindPermissionsArgs) =>
      requireNextly().permissions.find(args),
    findByID: (args: FindPermissionByIDArgs) =>
      requireNextly().permissions.findByID(args),
    create: (args: CreatePermissionArgs) =>
      requireNextly().permissions.create(args),
    delete: (args: DeletePermissionArgs) =>
      requireNextly().permissions.delete(args),
  },

  apiKeys: {
    list: (args?: ListApiKeysArgs) => requireNextly().apiKeys.list(args),
    findByID: (args: FindApiKeyByIDArgs) =>
      requireNextly().apiKeys.findByID(args),
    create: (args: CreateApiKeyArgs) => requireNextly().apiKeys.create(args),
    update: (args: UpdateApiKeyArgs) => requireNextly().apiKeys.update(args),
    revoke: (args: RevokeApiKeyArgs) => requireNextly().apiKeys.revoke(args),
  },

  access: {
    check: (args: CheckAccessArgs) => requireNextly().access.check(args),
    checkApiKey: (args: CheckApiKeyArgs) =>
      requireNextly().access.checkApiKey(args),
  },
};

// Both Direct API entry points answer for the pre-rename namespace: callers
// reach field groups either through an instance or through the `nextly` facade,
// and an untyped caller upgrading from `components` can arrive at either one.
installLegacyFieldGroupsNamespaceGuard(Nextly.prototype);
installLegacyFieldGroupsNamespaceGuard(nextly);
