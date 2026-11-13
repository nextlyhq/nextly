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

import { passwordCredentialDeps } from "../auth/credentials/credential-deps";
import type { CredentialDeps } from "../auth/credentials/verify-credentials";
import { container } from "../di/container";
import { isServicesRegistered } from "../di/service-access";
import type { ApiKeyService } from "../domains/auth/services/api-key-service";
import { AuthService } from "../domains/auth/services/auth-service";
import { PermissionService } from "../domains/auth/services/permission-service";
import type { RBACAccessControlService } from "../domains/auth/services/rbac-access-control-service";
import { RolePermissionService } from "../domains/auth/services/role-permission-service";
import { RoleService } from "../domains/auth/services/role-service";
import type { FieldGroupMetadataService } from "../domains/field-groups/services/field-group-metadata-service";
import { NextlyError } from "../errors/nextly-error";
import { assertBootMigrationsSettled } from "../init/boot-migrations-gate";
import { startInFlight } from "../init/start-in-flight";
import { createNextlyPrincipals } from "../plugins/principals/api";
import type { NextlyPrincipals } from "../plugins/principals/types";
import { buildPluginServicesNamespace } from "../plugins/services/plugin-services-registry";
import {
  publicSiteSettingsOf,
  type PublicSiteSettings,
} from "../runtime/site-settings-read";
import type { CollectionsHandler } from "../services/collections-handler";
import type { EmailProviderService } from "../services/email/email-provider-service";
import type { EmailService } from "../services/email/email-service";
import type { EmailTemplateService } from "../services/email/email-template-service";
import type { FieldGroupRegistryService } from "../services/field-groups/field-group-registry-service";
import type { GeneralSettingsService } from "../services/general-settings/general-settings-service";
import type { MediaService } from "../services/media/media-service";
import type { Logger } from "../services/shared";
import type { SingleEntryService } from "../services/singles/single-entry-service";
import type { SingleRegistryService } from "../services/singles/single-registry-service";
import { UserAccountService } from "../services/users/user-account-service";
import type { UserFieldDefinitionService } from "../services/users/user-field-definition-service";
import type { UserService } from "../services/users/user-service";
import { consoleLogger } from "../shared/types";

import { installLegacyFieldGroupsNamespaceGuard } from "./legacy-field-groups-namespace";
import * as authNs from "./namespaces/auth";
import * as collectionsNs from "./namespaces/collections";
import type { NextlyContext } from "./namespaces/context";
import { runAsCaller, withLanguagesPinned } from "./namespaces/helpers";
import {
  createAccessNamespace,
  createApiKeysNamespace,
  createContentEventsNamespace,
  createJobsNamespace,
  createNoticesNamespace,
  createVersionsNamespace,
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
  type ContentEventsNamespace,
  type JobsNamespace,
  type NoticesNamespace,
  type VersionsNamespace,
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
import { guardPrincipalOperations } from "./principal-boundary";
import type {
  ApplyEmailTemplateUpdateArgs,
  CompareEmailTemplateArgs,
  OverrideEmailTemplateArgs,
  ResetEmailTemplateArgs,
  UndoEmailTemplateUpdateArgs,
} from "./types/email";
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
  TimeseriesArgs,
  TimeseriesResult,
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
  FoundSingle,
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
  PublishArgs,
  PublishResult,
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
  FindMediaByIDsArgs,
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
  QueueEmailArgs,
  QueueTemplateEmailArgs,
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
  /** A person's own notices. */
  public readonly notices: NoticesNamespace;
  /** @experimental A document's history: list, read, compare, name, restore. */
  public readonly versions: VersionsNamespace;
  /** @experimental A subject's content events: a document's or a release's. */
  public readonly contentEvents: ContentEventsNamespace;
  /** @experimental Recognising a plugin's kind of signed-in person. */
  public readonly principals: NextlyPrincipals;

  /**
   * Create a new Nextly instance.
   *
   * @param config - Default configuration for all operations
   */
  constructor(config: DirectAPIConfig = {}) {
    refusePrincipalDefault(config);
    this.defaultConfig = {
      overrideAccess: true,
      ...config,
    };

    this.users = createUsersNamespace(this);
    this.media = createMediaNamespace(this);
    // One language list per call, as the collection and Single methods have through
    // `runAsCaller`: a submission writes an entry, and a field group's change seeds its rows.
    this.forms = withLanguagesPinned(createFormsNamespace(this));
    this.fieldGroups = withLanguagesPinned(createFieldGroupsNamespace(this));
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
    this.notices = createNoticesNamespace();
    this.versions = createVersionsNamespace(this);
    this.contentEvents = createContentEventsNamespace(this);
    this.principals = createNextlyPrincipals();

    // The instance its callers reach: only the collection and Single
    // operations may be made as a plugin-defined person, and every other
    // method and namespace refuses `principal` rather than ignore it and run
    // as the server.
    return guardPrincipalOperations(this);
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
        : consoleLogger;

      const emailService = container.has("emailService")
        ? container.get<EmailService>("emailService")
        : undefined;

      this._authService = new AuthService(adapter, logger, emailService);
    }
    return this._authService;
  }

  /** Cached password sign-in dependencies, shared with the auth router. */
  private _passwordCredentialDeps: CredentialDeps | null = null;

  /** @internal */
  public get passwordCredentialDeps(): CredentialDeps {
    this._passwordCredentialDeps ??= passwordCredentialDeps(() =>
      container.get<DrizzleAdapter>("adapter")
    );
    return this._passwordCredentialDeps;
  }

  /** Cached UserAccountService — not registered in the DI container. */
  private _userAccountService: UserAccountService | null = null;

  /** @internal */
  public get userAccountService(): UserAccountService {
    if (!this._userAccountService) {
      const adapter = container.get<DrizzleAdapter>("adapter");
      const logger = container.has("logger")
        ? container.get<Logger>("logger")
        : consoleLogger;
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
        : consoleLogger;
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
        : consoleLogger;
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
        : consoleLogger;
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
    return runAsCaller(this.defaultConfig, args, callArgs =>
      collectionsNs.find(this, callArgs)
    );
  }

  /**
   * Find a single document by ID. Returns `null` when not found and
   * `disableErrors` is `true`; otherwise throws.
   */
  findByID<TSlug extends CollectionSlug>(
    args: FindByIDArgs<TSlug>
  ): Promise<RowFromCollectionSlug<TSlug> | null> {
    return runAsCaller(this.defaultConfig, args, callArgs =>
      collectionsNs.findByID(this, callArgs)
    );
  }

  /**
   * Create a new document in a collection.
   *
   * created doc must read `result.item` (was a bare `T`).
   */
  create<TSlug extends CollectionSlug>(
    args: CreateArgs<TSlug>
  ): Promise<MutationResult<RowFromCollectionSlug<TSlug>>> {
    return runAsCaller(this.defaultConfig, args, callArgs =>
      collectionsNs.create(this, callArgs)
    );
  }

  /**
   * Update a document by ID or by `where` clause (returns the first match).
   *
   * updated doc must read `result.item` (was a bare `T`).
   */
  update<TSlug extends CollectionSlug>(
    args: UpdateArgs<TSlug>
  ): Promise<MutationResult<RowFromCollectionSlug<TSlug>>> {
    return runAsCaller(this.defaultConfig, args, callArgs =>
      collectionsNs.update(this, callArgs)
    );
  }

  /**
   * Publish the parts of one entry `args` chooses: some of its languages, or every one, and its
   * shared part. With `describe`, say what publishing them would do, and change nothing.
   *
   * @experimental Until publishing per language is complete.
   */
  publish(args: PublishArgs): Promise<MutationResult<PublishResult>> {
    return runAsCaller(this.defaultConfig, args, callArgs =>
      collectionsNs.publish(this, callArgs)
    );
  }

  /**
   * Unpublish the parts of one entry `args` chooses, or say what doing so would do.
   *
   * @experimental Until publishing per language is complete.
   */
  unpublish(args: PublishArgs): Promise<MutationResult<PublishResult>> {
    return runAsCaller(this.defaultConfig, args, callArgs =>
      collectionsNs.unpublish(this, callArgs)
    );
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
    return runAsCaller(this.defaultConfig, args, callArgs =>
      collectionsNs.deleteEntry(this, callArgs)
    );
  }

  /**
   * Count documents matching a query.
   *
   */
  count(args: CountArgs): Promise<CountResult> {
    return runAsCaller(this.defaultConfig, args, callArgs =>
      collectionsNs.count(this, callArgs)
    );
  }

  /**
   * How many documents carry each distinct value of one field.
   *
   * Answers over the rows a `count` with the same arguments would have
   * counted, because both resolve that row set through one pipeline.
   */
  group(args: GroupArgs): Promise<GroupResult> {
    return runAsCaller(this.defaultConfig, args, callArgs =>
      collectionsNs.group(this, callArgs)
    );
  }

  /** How many documents fall in each interval of a recent window. */
  timeseries(args: TimeseriesArgs): Promise<TimeseriesResult> {
    return runAsCaller(this.defaultConfig, args, callArgs =>
      collectionsNs.timeseries(this, callArgs)
    );
  }

  /** Bulk-delete multiple documents by IDs (partial success pattern). */
  bulkDelete(args: BulkDeleteArgs): Promise<BulkOperationResult> {
    return runAsCaller(this.defaultConfig, args, callArgs =>
      collectionsNs.bulkDelete(this, callArgs)
    );
  }

  /**
   * Duplicate a document (optionally applying field overrides).
   *
   * duplicated doc must read `result.item` (was a bare `T`).
   */
  duplicate<TSlug extends CollectionSlug>(
    args: DuplicateArgs<TSlug>
  ): Promise<MutationResult<RowFromCollectionSlug<TSlug>>> {
    return runAsCaller(this.defaultConfig, args, callArgs =>
      collectionsNs.duplicate(this, callArgs)
    );
  }

  /**
   * Get a Single (global) document by slug. With `createIfMissing: false`, a
   * Single that has no stored document answers `null` and nothing is created;
   * `FoundSingle` adds `null` to the type only for such a call.
   */
  findSingle<
    TSlug extends SingleSlug,
    TCreate extends boolean | undefined = undefined,
  >(
    args: FindSingleArgs<TSlug> & { createIfMissing?: TCreate }
  ): Promise<FoundSingle<TSlug, TCreate>> {
    return runAsCaller(this.defaultConfig, args, callArgs =>
      singlesNs.findSingle(this, callArgs)
    );
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
    return runAsCaller(this.defaultConfig, args, callArgs =>
      singlesNs.updateSingle(this, callArgs)
    );
  }

  /** Fetch the content of every registered Single. */
  findSingles(args: FindSinglesArgs = {}): Promise<SingleListResult> {
    return runAsCaller(this.defaultConfig, args, callArgs =>
      singlesNs.findSingles(this, callArgs)
    );
  }

  /**
   * The site's general settings a published page may show: its name, its
   * address, its logo and its time zone, each `null` until the site sets it.
   * Nothing else the settings hold comes back, the administrator's email
   * among it, since the answer is the public allowlist's.
   *
   * A method of the instance so a page served by an instance of its own reads
   * that instance's site, as it reads its content: `readPublicSiteSettings`
   * from `nextly/runtime`, and the block page routes, read it through here.
   *
   * @experimental
   */
  async publicSiteSettings(): Promise<PublicSiteSettings> {
    const settings = await container
      .get<GeneralSettingsService>("generalSettingsService")
      .getSettings();
    return publicSiteSettingsOf(settings);
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
    data: {
      name?: string;
      image?: string;
      /** A language tag (`fr`, `pt-BR`), or null to follow the browser. */
      interfaceLanguage?: string | null;
    };
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
/**
 * Refuse a person named as a Direct API default. A person is named per call:
 * each operation reads `principal` off its own arguments only, so a default
 * one would be ignored, and every call would run as the server under the
 * instance's `overrideAccess: true`.
 */
function refusePrincipalDefault(config: DirectAPIConfig | undefined): void {
  if (
    (config as { principal?: unknown } | undefined)?.principal === undefined
  ) {
    return;
  }
  throw NextlyError.invalidInput({
    message:
      "principal cannot be a Direct API default: pass it on each collection or Single operation made as the person.",
    logContext: { reason: "principal-default-refused" },
  });
}

export function requireNextly(config?: DirectAPIConfig): Nextly {
  // Before the singleton is reused, whose construction would otherwise be
  // the only place a default person is refused.
  refusePrincipalDefault(config);
  // Registered is not the same as allowed to serve: a process whose boot
  // migrations refused must not serve, and a boot still migrating has not
  // answered yet. This getter is synchronous, so it cannot wait for that
  // answer the way the async surfaces do; it refuses instead.
  assertBootMigrationsSettled();

  if (!isServicesRegistered()) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage:
        "Nextly services not initialized. Call registerServices() before using the Direct API.",
      statusCode: 500,
      // The start-up hook no longer holds requests until Nextly has started,
      // so code that reads synchronously can now run while a start is under
      // way: said apart from nothing having started, with the way to wait.
      ...(startInFlight()
        ? {
            logMessage:
              "requireNextly() was called while Nextly is still starting. " +
              "Await `getNextly({ config })` or `getCachedNextly()`, which " +
              "wait for the start, before reading synchronously.",
          }
        : {}),
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
 * `requireNextly()`, once any start in flight has finished, or a failed one
 * has been made again.
 *
 * The start-up hook begins Nextly's start without waiting for it, so a request
 * can reach a reader while the start is under way. A reader that can wait
 * (the module-level `nextly` object below, a content route's default reader)
 * waits here for that one start, then reads as `requireNextly()` does. A start
 * that failed is made again first (`awaitStartOrRetry`), so the worker recovers
 * once the database is back. Where nothing is starting it reads at once, and
 * where nothing has started it refuses exactly as `requireNextly()` does.
 */
export async function requireNextlyOnceStarted(): Promise<Nextly> {
  // Loaded when a reader first waits: the start imports this module, so a
  // static import here would be a cycle.
  const { awaitStartOrRetry } = await import("../init");
  await awaitStartOrRetry();
  return requireNextly();
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
 * **Important:** the runtime must already be initialised, or starting, before
 * any method on this object is called. Each one waits for a start in flight
 * and then resolves through `requireNextly()`, which throws when nothing has
 * registered services. `getNextly({ config })` from `nextly` is what
 * initialises.
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
  find: async <TSlug extends CollectionSlug>(args: FindArgs<TSlug>) =>
    (await requireNextlyOnceStarted()).find(args),
  findByID: async <TSlug extends CollectionSlug>(args: FindByIDArgs<TSlug>) =>
    (await requireNextlyOnceStarted()).findByID(args),
  create: async <TSlug extends CollectionSlug>(args: CreateArgs<TSlug>) =>
    (await requireNextlyOnceStarted()).create(args),
  update: async <TSlug extends CollectionSlug>(args: UpdateArgs<TSlug>) =>
    (await requireNextlyOnceStarted()).update(args),
  /** Publish the chosen parts of one entry. @experimental */
  publish: async (args: PublishArgs) =>
    (await requireNextlyOnceStarted()).publish(args),
  /** Unpublish the chosen parts of one entry. @experimental */
  unpublish: async (args: PublishArgs) =>
    (await requireNextlyOnceStarted()).unpublish(args),
  delete: async (args: DeleteArgs) =>
    (await requireNextlyOnceStarted()).delete(args),
  count: async (args: CountArgs) =>
    (await requireNextlyOnceStarted()).count(args),
  group: async (args: GroupArgs) =>
    (await requireNextlyOnceStarted()).group(args),
  timeseries: async (args: TimeseriesArgs) =>
    (await requireNextlyOnceStarted()).timeseries(args),
  bulkDelete: async (args: BulkDeleteArgs) =>
    (await requireNextlyOnceStarted()).bulkDelete(args),
  duplicate: async <TSlug extends CollectionSlug>(args: DuplicateArgs<TSlug>) =>
    (await requireNextlyOnceStarted()).duplicate(args),

  // Generic in `TCreate` as the method is, so this delegate answers the same
  // type for the same call. The answer type and the inner call's type
  // arguments are stated rather than inferred: inferred, a call that left
  // `createIfMissing` out resolved the inner `TCreate` to nothing and answered
  // `never`.
  findSingle: async <
    TSlug extends SingleSlug,
    TCreate extends boolean | undefined = undefined,
  >(
    args: FindSingleArgs<TSlug> & { createIfMissing?: TCreate }
  ): Promise<FoundSingle<TSlug, TCreate>> =>
    (await requireNextlyOnceStarted()).findSingle<TSlug, TCreate>(args),
  updateSingle: async <TSlug extends SingleSlug>(
    args: UpdateSingleArgs<TSlug>
  ) => (await requireNextlyOnceStarted()).updateSingle(args),
  findSingles: async (args?: FindSinglesArgs) =>
    (await requireNextlyOnceStarted()).findSingles(args ?? {}),
  // Delegated like the reads above, so this object handed to a page route as
  // its reader still shows the site's settings.
  publicSiteSettings: async (): Promise<PublicSiteSettings> =>
    (await requireNextlyOnceStarted()).publicSiteSettings(),

  login: async (args: LoginArgs) =>
    (await requireNextlyOnceStarted()).login(args),
  logout: async () => (await requireNextlyOnceStarted()).logout(),
  me: async (args: { user: UserContext }) =>
    (await requireNextlyOnceStarted()).me(args),
  updateMe: async (args: {
    user: UserContext;
    data: {
      name?: string;
      image?: string;
      /** A language tag (`fr`, `pt-BR`), or null to follow the browser. */
      interfaceLanguage?: string | null;
    };
  }) => (await requireNextlyOnceStarted()).updateMe(args),
  register: async (args: RegisterArgs) =>
    (await requireNextlyOnceStarted()).register(args),
  changePassword: async (args: ChangePasswordArgs & { user: UserContext }) =>
    (await requireNextlyOnceStarted()).changePassword(args),
  forgotPassword: async (args: ForgotPasswordArgs) =>
    (await requireNextlyOnceStarted()).forgotPassword(args),
  resetPassword: async (args: ResetPasswordArgs) =>
    (await requireNextlyOnceStarted()).resetPassword(args),
  verifyEmail: async (args: VerifyEmailArgs) =>
    (await requireNextlyOnceStarted()).verifyEmail(args),

  jobs: {
    queue: async <TTask extends JobSlug>(args: QueueJobArgs<TTask>) =>
      (await requireNextlyOnceStarted()).jobs.queue(args),
  },

  principals: {
    fromRequest: async (request: Request, kind: string) =>
      (await requireNextlyOnceStarted()).principals.fromRequest(request, kind),
    byId: async (kind: string, id: string) =>
      (await requireNextlyOnceStarted()).principals.byId(kind, id),
  },

  notices: {
    find: async (args: Parameters<NoticesNamespace["find"]>[0]) =>
      (await requireNextlyOnceStarted()).notices.find(args),
    count: async (args: Parameters<NoticesNamespace["count"]>[0]) =>
      (await requireNextlyOnceStarted()).notices.count(args),
    markRead: async (args: Parameters<NoticesNamespace["markRead"]>[0]) =>
      (await requireNextlyOnceStarted()).notices.markRead(args),
  },

  contentEvents: {
    list: async args =>
      (await requireNextlyOnceStarted()).contentEvents.list(args),
  } satisfies ContentEventsNamespace,

  // Checked against the namespace's own type, so a method added there and
  // not delegated here is a compile error rather than a gap a caller finds.
  releases: {
    create: async args =>
      (await requireNextlyOnceStarted()).releases.create(args),
    // Optional, as the namespace declares them: `satisfies` keeps an arrow's
    // own parameter list, so a bare `args =>` would require an argument.
    find: async (args?) =>
      (await requireNextlyOnceStarted()).releases.find(args),
    count: async (args?) =>
      (await requireNextlyOnceStarted()).releases.count(args),
    calendar: async args =>
      (await requireNextlyOnceStarted()).releases.calendar(args),
    findByID: async args =>
      (await requireNextlyOnceStarted()).releases.findByID(args),
    capabilities: async args =>
      (await requireNextlyOnceStarted()).releases.capabilities(args),
    blockingReasons: async args =>
      (await requireNextlyOnceStarted()).releases.blockingReasons(args),
    blockersOf: async args =>
      (await requireNextlyOnceStarted()).releases.blockersOf(args),
    readiness: async args =>
      (await requireNextlyOnceStarted()).releases.readiness(args),
    readinessOf: async args =>
      (await requireNextlyOnceStarted()).releases.readinessOf(args),
    memberCounts: async args =>
      (await requireNextlyOnceStarted()).releases.memberCounts(args),
    addMember: async args =>
      (await requireNextlyOnceStarted()).releases.addMember(args),
    addMembers: async args =>
      (await requireNextlyOnceStarted()).releases.addMembers(args),
    scheduleDocument: async args =>
      (await requireNextlyOnceStarted()).releases.scheduleDocument(args),
    removeMember: async args =>
      (await requireNextlyOnceStarted()).releases.removeMember(args),
    changeMemberAction: async args =>
      (await requireNextlyOnceStarted()).releases.changeMemberAction(args),
    listMembers: async args =>
      (await requireNextlyOnceStarted()).releases.listMembers(args),
    membersOf: async args =>
      (await requireNextlyOnceStarted()).releases.membersOf(args),
    schedule: async args =>
      (await requireNextlyOnceStarted()).releases.schedule(args),
    cancel: async args =>
      (await requireNextlyOnceStarted()).releases.cancel(args),
    publishNow: async args =>
      (await requireNextlyOnceStarted()).releases.publishNow(args),
    update: async args =>
      (await requireNextlyOnceStarted()).releases.update(args),
    delete: async args =>
      (await requireNextlyOnceStarted()).releases.delete(args),
  } satisfies ReleasesNamespace,

  users: {
    find: async (args?: FindUsersArgs) =>
      (await requireNextlyOnceStarted()).users.find(args),
    findOne: async (args?: FindOneUserArgs) =>
      (await requireNextlyOnceStarted()).users.findOne(args),
    findByID: async (args: FindUserByIDArgs) =>
      (await requireNextlyOnceStarted()).users.findByID(args),
    create: async (args: CreateUserArgs) =>
      (await requireNextlyOnceStarted()).users.create(args),
    update: async (args: UpdateUserArgs) =>
      (await requireNextlyOnceStarted()).users.update(args),
    delete: async (args: DeleteUserArgs) =>
      (await requireNextlyOnceStarted()).users.delete(args),
  },

  media: {
    upload: async (args: UploadMediaArgs) =>
      (await requireNextlyOnceStarted()).media.upload(args),
    find: async (args?: FindMediaArgs) =>
      (await requireNextlyOnceStarted()).media.find(args),
    findByID: async (args: FindMediaByIDArgs) =>
      (await requireNextlyOnceStarted()).media.findByID(args),
    findByIDs: async (args: FindMediaByIDsArgs) =>
      (await requireNextlyOnceStarted()).media.findByIDs(args),
    update: async (args: UpdateMediaArgs) =>
      (await requireNextlyOnceStarted()).media.update(args),
    delete: async (args: DeleteMediaArgs) =>
      (await requireNextlyOnceStarted()).media.delete(args),
    bulkDelete: async (args: BulkDeleteMediaArgs) =>
      (await requireNextlyOnceStarted()).media.bulkDelete(args),
    folders: {
      list: async (args?: ListFoldersArgs) =>
        (await requireNextlyOnceStarted()).media.folders.list(args),
      create: async (args: CreateFolderArgs) =>
        (await requireNextlyOnceStarted()).media.folders.create(args),
    },
  },

  forms: {
    find: async (args?: FindFormsArgs) =>
      (await requireNextlyOnceStarted()).forms.find(args),
    findBySlug: async (args: FindFormBySlugArgs) =>
      (await requireNextlyOnceStarted()).forms.findBySlug(args),
    submit: async (args: SubmitFormArgs) =>
      (await requireNextlyOnceStarted()).forms.submit(args),
    submissions: async (args: FormSubmissionsArgs) =>
      (await requireNextlyOnceStarted()).forms.submissions(args),
  },

  fieldGroups: {
    find: async (args?: FindFieldGroupsArgs) =>
      (await requireNextlyOnceStarted()).fieldGroups.find(args),
    findBySlug: async (args: FindFieldGroupBySlugArgs) =>
      (await requireNextlyOnceStarted()).fieldGroups.findBySlug(args),
    create: async (args: CreateFieldGroupArgs) =>
      (await requireNextlyOnceStarted()).fieldGroups.create(args),
    update: async (args: UpdateFieldGroupArgs) =>
      (await requireNextlyOnceStarted()).fieldGroups.update(args),
    delete: async (args: DeleteFieldGroupArgs) =>
      (await requireNextlyOnceStarted()).fieldGroups.delete(args),
  },

  email: {
    send: async (args: SendEmailArgs) =>
      (await requireNextlyOnceStarted()).email.send(args),
    sendWithTemplate: async (args: SendTemplateEmailArgs) =>
      (await requireNextlyOnceStarted()).email.sendWithTemplate(args),
    queue: async (args: QueueEmailArgs) =>
      (await requireNextlyOnceStarted()).email.queue(args),
    queueWithTemplate: async (args: QueueTemplateEmailArgs) =>
      (await requireNextlyOnceStarted()).email.queueWithTemplate(args),
  },

  emailProviders: {
    find: async (args?: FindEmailProvidersArgs) =>
      (await requireNextlyOnceStarted()).emailProviders.find(args),
    findByID: async (args: FindEmailProviderByIDArgs) =>
      (await requireNextlyOnceStarted()).emailProviders.findByID(args),
    create: async (args: CreateEmailProviderArgs) =>
      (await requireNextlyOnceStarted()).emailProviders.create(args),
    update: async (args: UpdateEmailProviderArgs) =>
      (await requireNextlyOnceStarted()).emailProviders.update(args),
    delete: async (args: DeleteEmailProviderArgs) =>
      (await requireNextlyOnceStarted()).emailProviders.delete(args),
    setDefault: async (args: SetDefaultProviderArgs) =>
      (await requireNextlyOnceStarted()).emailProviders.setDefault(args),
    test: async (args: TestEmailProviderArgs) =>
      (await requireNextlyOnceStarted()).emailProviders.test(args),
  },

  emailTemplates: {
    find: async (args?: FindEmailTemplatesArgs) =>
      (await requireNextlyOnceStarted()).emailTemplates.find(args),
    findByID: async (args: FindEmailTemplateByIDArgs) =>
      (await requireNextlyOnceStarted()).emailTemplates.findByID(args),
    findBySlug: async (args: FindEmailTemplateBySlugArgs) =>
      (await requireNextlyOnceStarted()).emailTemplates.findBySlug(args),
    create: async (args: CreateEmailTemplateArgs) =>
      (await requireNextlyOnceStarted()).emailTemplates.create(args),
    update: async (args: UpdateEmailTemplateArgs) =>
      (await requireNextlyOnceStarted()).emailTemplates.update(args),
    delete: async (args: DeleteEmailTemplateArgs) =>
      (await requireNextlyOnceStarted()).emailTemplates.delete(args),
    preview: async (args: PreviewEmailTemplateArgs) =>
      (await requireNextlyOnceStarted()).emailTemplates.preview(args),
    /** @experimental */
    override: async (args: OverrideEmailTemplateArgs) =>
      (await requireNextlyOnceStarted()).emailTemplates.override(args),
    /** @experimental */
    reset: async (args: ResetEmailTemplateArgs) =>
      (await requireNextlyOnceStarted()).emailTemplates.reset(args),
    /** @experimental */
    compare: async (args: CompareEmailTemplateArgs) =>
      (await requireNextlyOnceStarted()).emailTemplates.compare(args),
    /** @experimental */
    applyUpdate: async (args: ApplyEmailTemplateUpdateArgs) =>
      (await requireNextlyOnceStarted()).emailTemplates.applyUpdate(args),
    /** @experimental */
    undoUpdate: async (args: UndoEmailTemplateUpdateArgs) =>
      (await requireNextlyOnceStarted()).emailTemplates.undoUpdate(args),
  },

  userFields: {
    find: async (args?: FindUserFieldsArgs) =>
      (await requireNextlyOnceStarted()).userFields.find(args),
    findByID: async (args: FindUserFieldByIDArgs) =>
      (await requireNextlyOnceStarted()).userFields.findByID(args),
    create: async (args: CreateUserFieldArgs) =>
      (await requireNextlyOnceStarted()).userFields.create(args),
    update: async (args: UpdateUserFieldArgs) =>
      (await requireNextlyOnceStarted()).userFields.update(args),
    delete: async (args: DeleteUserFieldArgs) =>
      (await requireNextlyOnceStarted()).userFields.delete(args),
    reorder: async (args: ReorderUserFieldsArgs) =>
      (await requireNextlyOnceStarted()).userFields.reorder(args),
  },

  roles: {
    find: async (args?: FindRolesArgs) =>
      (await requireNextlyOnceStarted()).roles.find(args),
    findByID: async (args: FindRoleByIDArgs) =>
      (await requireNextlyOnceStarted()).roles.findByID(args),
    create: async (args: CreateRoleArgs) =>
      (await requireNextlyOnceStarted()).roles.create(args),
    update: async (args: UpdateRoleArgs) =>
      (await requireNextlyOnceStarted()).roles.update(args),
    delete: async (args: DeleteRoleArgs) =>
      (await requireNextlyOnceStarted()).roles.delete(args),
    getPermissions: async (args: GetRolePermissionsArgs) =>
      (await requireNextlyOnceStarted()).roles.getPermissions(args),
    setPermissions: async (args: SetRolePermissionsArgs) =>
      (await requireNextlyOnceStarted()).roles.setPermissions(args),
  },

  permissions: {
    find: async (args?: FindPermissionsArgs) =>
      (await requireNextlyOnceStarted()).permissions.find(args),
    findByID: async (args: FindPermissionByIDArgs) =>
      (await requireNextlyOnceStarted()).permissions.findByID(args),
    create: async (args: CreatePermissionArgs) =>
      (await requireNextlyOnceStarted()).permissions.create(args),
    delete: async (args: DeletePermissionArgs) =>
      (await requireNextlyOnceStarted()).permissions.delete(args),
  },

  apiKeys: {
    list: async (args?: ListApiKeysArgs) =>
      (await requireNextlyOnceStarted()).apiKeys.list(args),
    findByID: async (args: FindApiKeyByIDArgs) =>
      (await requireNextlyOnceStarted()).apiKeys.findByID(args),
    create: async (args: CreateApiKeyArgs) =>
      (await requireNextlyOnceStarted()).apiKeys.create(args),
    update: async (args: UpdateApiKeyArgs) =>
      (await requireNextlyOnceStarted()).apiKeys.update(args),
    revoke: async (args: RevokeApiKeyArgs) =>
      (await requireNextlyOnceStarted()).apiKeys.revoke(args),
  },

  access: {
    check: async (args: CheckAccessArgs) =>
      (await requireNextlyOnceStarted()).access.check(args),
    checkApiKey: async (args: CheckApiKeyArgs) =>
      (await requireNextlyOnceStarted()).access.checkApiKey(args),
  },
};

// Both Direct API entry points answer for the pre-rename namespace: callers
// reach field groups either through an instance or through the `nextly` facade,
// and an untyped caller upgrading from `components` can arrive at either one.
installLegacyFieldGroupsNamespaceGuard(Nextly.prototype);
installLegacyFieldGroupsNamespaceGuard(nextly);
