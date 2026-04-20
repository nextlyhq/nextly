/**
 * Nextly Instance Type Definition
 *
 * Defines the public `Nextly` interface exposed by `getNextly()`.
 * Extracted from `init.ts` to keep the initialization orchestration file
 * focused on lifecycle/cache concerns.
 *
 * The interface is re-exported from `../init.ts` so all existing imports
 * like `import type { Nextly } from "@revnixhq/nextly"` continue to work.
 *
 * @module init/nextly-instance
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import type { ServiceMap } from "../di/register";
import type {
  AuthResult,
  BulkDeleteArgs,
  BulkDeleteMediaArgs,
  BulkOperationResult,
  ChangePasswordArgs,
  CheckAccessArgs,
  CollectionSlug,
  CountArgs,
  CountResult,
  CreateArgs,
  CreateEmailProviderArgs,
  CreateEmailTemplateArgs,
  CreateFolderArgs,
  CreatePermissionArgs,
  CreateRoleArgs,
  CreateUserArgs,
  CreateUserFieldArgs,
  DataFromCollectionSlug,
  DataFromSingleSlug,
  DeleteArgs,
  DeleteEmailProviderArgs,
  DeleteEmailTemplateArgs,
  DeleteMediaArgs,
  DeletePermissionArgs,
  DeleteResult,
  DeleteRoleArgs,
  DeleteUserArgs,
  DeleteUserFieldArgs,
  DuplicateArgs,
  FindArgs,
  FindByIDArgs,
  FindEmailProviderByIDArgs,
  FindEmailProvidersArgs,
  FindEmailTemplateByIDArgs,
  FindEmailTemplateBySlugArgs,
  FindEmailTemplatesArgs,
  FindFormBySlugArgs,
  FindFormsArgs,
  FindGlobalArgs,
  FindGlobalsArgs,
  FindMediaArgs,
  FindMediaByIDArgs,
  FindPermissionByIDArgs,
  FindPermissionsArgs,
  FindRoleByIDArgs,
  FindRolesArgs,
  FindUserByIDArgs,
  FindUserFieldByIDArgs,
  FindUserFieldsArgs,
  FindUsersArgs,
  ForgotPasswordArgs,
  FormSubmissionsArgs,
  GetEmailLayoutArgs,
  GetRolePermissionsArgs,
  ListFoldersArgs,
  LoginArgs,
  Permission,
  PreviewEmailTemplateArgs,
  RegisterArgs,
  ReorderUserFieldsArgs,
  ResetPasswordArgs,
  Role,
  SendEmailArgs,
  SendEmailResult,
  SendTemplateEmailArgs,
  SetDefaultProviderArgs,
  SetRolePermissionsArgs,
  SingleListResult,
  SingleSlug,
  SubmitFormArgs,
  SubmitFormResult,
  TestEmailProviderArgs,
  UpdateArgs,
  UpdateEmailLayoutArgs,
  UpdateEmailProviderArgs,
  UpdateEmailTemplateArgs,
  UpdateGlobalArgs,
  UpdateMediaArgs,
  UpdateRoleArgs,
  UpdateUserArgs,
  UpdateUserFieldArgs,
  UploadMediaArgs,
  UserContext,
  VerifyEmailArgs,
} from "../direct-api/types";
import type { EmailProviderRecord } from "../schemas/email-providers/types";
import type { EmailTemplateRecord } from "../schemas/email-templates/types";
import type { UserFieldDefinitionRecord } from "../schemas/user-field-definitions/types";
import type { MediaFile, MediaFolder } from "../services/media/media-service";
import type { User } from "../services/users/user-service";
import type { PaginatedResponse } from "../types/pagination";

/**
 * Nextly instance - provides access to all services and APIs.
 *
 * This is the main interface for interacting with Nextly. It provides
 * direct access to all core services and the database adapter.
 *
 * The instance is cached as a singleton, so multiple calls to `getNextly()`
 * will return the same instance.
 *
 * **Direct API Methods:**
 * - `find()`, `findByID()`, `create()`, `update()`, `delete()`
 * - `count()`, `bulkDelete()`, `duplicate()`
 * - `findGlobal()`, `updateGlobal()`
 *
 * **Service Accessors:**
 * - `collections`, `users`, `media`, `storage`, `adapter`
 */
export interface Nextly {
  // ==========================================================================
  // Direct API Methods
  // ==========================================================================

  /**
   * Find multiple documents in a collection.
   *
   * @example
   * ```typescript
   * const posts = await nextly.find({
   *   collection: 'posts',
   *   where: { status: { equals: 'published' } },
   *   limit: 10,
   *   sort: '-createdAt',
   * });
   * ```
   */
  find: <TSlug extends CollectionSlug>(
    args: FindArgs<TSlug>
  ) => Promise<PaginatedResponse<DataFromCollectionSlug<TSlug>>>;

  /**
   * Find a single document by ID.
   *
   * @example
   * ```typescript
   * const post = await nextly.findByID({
   *   collection: 'posts',
   *   id: 'post-123',
   * });
   * ```
   */
  findByID: <TSlug extends CollectionSlug>(
    args: FindByIDArgs<TSlug>
  ) => Promise<DataFromCollectionSlug<TSlug> | null>;

  /**
   * Create a new document.
   *
   * @example
   * ```typescript
   * const post = await nextly.create({
   *   collection: 'posts',
   *   data: { title: 'Hello', content: 'World' },
   * });
   * ```
   */
  create: <TSlug extends CollectionSlug>(
    args: CreateArgs<TSlug>
  ) => Promise<DataFromCollectionSlug<TSlug>>;

  /**
   * Update a document by ID.
   *
   * @example
   * ```typescript
   * const updated = await nextly.update({
   *   collection: 'posts',
   *   id: 'post-123',
   *   data: { status: 'published' },
   * });
   * ```
   */
  update: <TSlug extends CollectionSlug>(
    args: UpdateArgs<TSlug>
  ) => Promise<DataFromCollectionSlug<TSlug>>;

  /**
   * Delete a document by ID.
   *
   * @example
   * ```typescript
   * const result = await nextly.delete({
   *   collection: 'posts',
   *   id: 'post-123',
   * });
   * ```
   */
  delete: (args: DeleteArgs) => Promise<DeleteResult>;

  /**
   * Count documents matching a query.
   *
   * @example
   * ```typescript
   * const { totalDocs } = await nextly.count({
   *   collection: 'posts',
   *   where: { status: { equals: 'published' } },
   * });
   * ```
   */
  count: (args: CountArgs) => Promise<CountResult>;

  /**
   * Bulk delete multiple documents by IDs.
   *
   * @example
   * ```typescript
   * const result = await nextly.bulkDelete({
   *   collection: 'posts',
   *   ids: ['post-1', 'post-2'],
   * });
   * ```
   */
  bulkDelete: (args: BulkDeleteArgs) => Promise<BulkOperationResult>;

  /**
   * Duplicate a document.
   *
   * @example
   * ```typescript
   * const copy = await nextly.duplicate({
   *   collection: 'posts',
   *   id: 'post-123',
   * });
   * ```
   */
  duplicate: <TSlug extends CollectionSlug>(
    args: DuplicateArgs<TSlug>
  ) => Promise<DataFromCollectionSlug<TSlug>>;

  /**
   * Get a Single/Global document.
   *
   * @example
   * ```typescript
   * const settings = await nextly.findGlobal({
   *   slug: 'site-settings',
   * });
   * ```
   */
  findGlobal: <TSlug extends SingleSlug>(
    args: FindGlobalArgs<TSlug>
  ) => Promise<DataFromSingleSlug<TSlug>>;

  /**
   * Update a Single/Global document.
   *
   * @example
   * ```typescript
   * const updated = await nextly.updateGlobal({
   *   slug: 'site-settings',
   *   data: { siteName: 'My Site' },
   * });
   * ```
   */
  updateGlobal: <TSlug extends SingleSlug>(
    args: UpdateGlobalArgs<TSlug>
  ) => Promise<DataFromSingleSlug<TSlug>>;

  /**
   * List all registered Single/Global type definitions.
   */
  findGlobals: (args?: FindGlobalsArgs) => Promise<SingleListResult>;

  // ==========================================================================
  // Authentication Methods
  // ==========================================================================

  /**
   * Verify user credentials and return user info.
   *
   * Since Direct API operates server-side without sessions, this simply
   * verifies credentials and returns the user object (no JWT token).
   *
   * @example
   * ```typescript
   * const result = await nextly.login({
   *   email: 'user@example.com',
   *   password: 'password123',
   * });
   * console.log('Logged in as:', result.user.email);
   * ```
   */
  login: (args: LoginArgs) => Promise<{ user: Record<string, unknown> }>;

  /**
   * Logout operation (no-op for Direct API).
   *
   * Since Direct API operates server-side without sessions,
   * logout is a no-op. Session management should be handled
   * at the application level.
   */
  logout: () => Promise<void>;

  /**
   * Get the current user's profile.
   *
   * Requires `user.id` to be provided since Direct API
   * doesn't have implicit session state.
   *
   * @example
   * ```typescript
   * const profile = await nextly.me({
   *   user: { id: session.user.id },
   * });
   * ```
   */
  me: (args: { user: UserContext }) => Promise<AuthResult>;

  /**
   * Update the current user's profile (name and image only).
   *
   * @example
   * ```typescript
   * const updated = await nextly.updateMe({
   *   user: { id: session.user.id },
   *   data: { name: 'New Name' },
   * });
   * ```
   */
  updateMe: (args: {
    user: UserContext;
    data: { name?: string; image?: string };
  }) => Promise<AuthResult>;

  /**
   * Register a new user.
   *
   * @example
   * ```typescript
   * const result = await nextly.register({
   *   email: 'newuser@example.com',
   *   password: 'securePassword123!',
   *   name: 'New User',
   * });
   * ```
   */
  register: (args: RegisterArgs) => Promise<{ user: Record<string, unknown> }>;

  /**
   * Change the current user's password.
   *
   * Requires `user.id` and current password for verification.
   *
   * @example
   * ```typescript
   * await nextly.changePassword({
   *   user: { id: session.user.id },
   *   currentPassword: 'oldPassword123',
   *   newPassword: 'newSecurePassword456!',
   * });
   * ```
   */
  changePassword: (
    args: ChangePasswordArgs & { user: UserContext }
  ) => Promise<{ success: true }>;

  /**
   * Initiate password reset by generating a reset token.
   *
   * Returns the raw token which should be sent to the user via email.
   *
   * @example
   * ```typescript
   * const result = await nextly.forgotPassword({
   *   email: 'user@example.com',
   * });
   * if (result.token) {
   *   await sendResetEmail(args.email, result.token);
   * }
   * ```
   */
  forgotPassword: (
    args: ForgotPasswordArgs
  ) => Promise<{ success: true; token?: string }>;

  /**
   * Reset password using a reset token.
   *
   * @example
   * ```typescript
   * const result = await nextly.resetPassword({
   *   token: 'reset-token-from-email',
   *   password: 'newSecurePassword456!',
   * });
   * ```
   */
  resetPassword: (
    args: ResetPasswordArgs
  ) => Promise<{ success: true; email?: string }>;

  /**
   * Verify user email using a verification token.
   *
   * @example
   * ```typescript
   * const result = await nextly.verifyEmail({
   *   token: 'verification-token-from-email',
   * });
   * ```
   */
  verifyEmail: (
    args: VerifyEmailArgs
  ) => Promise<{ success: true; email?: string }>;

  // ==========================================================================
  // Service Accessors
  // ==========================================================================

  /**
   * Collection service - manage collections and their entries.
   *
   * @example
   * ```typescript
   * const nextly = await getNextly(config);
   *
   * // Find documents
   * const posts = await nextly.collections.find('posts', {
   *   where: { status: 'published' }
   * }, context);
   *
   * // Create document
   * const newPost = await nextly.collections.create('posts', {
   *   data: { title: 'Hello World' }
   * }, context);
   * ```
   */
  collections: ServiceMap["collectionService"];

  /**
   * Users API namespace - CRUD operations for users.
   *
   * Provides direct database operations for user management without HTTP overhead.
   *
   * @example
   * ```typescript
   * const nextly = await getNextly(config);
   *
   * // Find users
   * const users = await nextly.users.find({
   *   where: { role: { equals: 'admin' } },
   *   limit: 10,
   * });
   *
   * // Get user by ID
   * const user = await nextly.users.findByID({ id: 'user-123' });
   *
   * // Create user
   * const newUser = await nextly.users.create({
   *   email: 'user@example.com',
   *   password: 'secure123',
   *   data: { name: 'John Doe' },
   * });
   *
   * // Update user
   * await nextly.users.update({
   *   id: 'user-123',
   *   data: { name: 'Jane Doe' },
   * });
   *
   * // Delete user
   * await nextly.users.delete({ id: 'user-123' });
   * ```
   */
  users: {
    find: (args?: FindUsersArgs) => Promise<PaginatedResponse<User>>;
    findByID: (args: FindUserByIDArgs) => Promise<User | null>;
    create: (args: CreateUserArgs) => Promise<User>;
    update: (args: UpdateUserArgs) => Promise<User>;
    delete: (args: DeleteUserArgs) => Promise<DeleteResult>;
  };

  /**
   * User service - direct access to UserService for advanced operations.
   *
   * For most use cases, prefer the `users` namespace above which provides
   * a simplified CRUD API. Use this for advanced operations like
   * authentication, password management, etc.
   *
   * @example
   * ```typescript
   * const nextly = await getNextly(config);
   *
   * // Authenticate user
   * const user = await nextly.userService.authenticate('user@example.com', 'password');
   *
   * // Change password
   * await nextly.userService.changePassword(userId, oldPass, newPass);
   * ```
   */
  userService: ServiceMap["userService"];

  /**
   * Media API namespace - operations for media files and folders.
   *
   * Provides direct database operations for media management without HTTP overhead.
   *
   * @example
   * ```typescript
   * const nextly = await getNextly(config);
   *
   * // Upload media
   * const media = await nextly.media.upload({
   *   file: { data: buffer, name: 'image.jpg', mimetype: 'image/jpeg', size: buffer.length },
   *   altText: 'My image',
   * });
   *
   * // List media
   * const files = await nextly.media.find({ folder: 'uploads', limit: 20 });
   *
   * // Get by ID
   * const file = await nextly.media.findByID({ id: 'media-123' });
   *
   * // Update metadata
   * await nextly.media.update({ id: 'media-123', data: { altText: 'Updated' } });
   *
   * // Delete
   * await nextly.media.delete({ id: 'media-123' });
   *
   * // Folders
   * const folder = await nextly.media.folders.create({ name: 'Photos' });
   * const folders = await nextly.media.folders.list();
   * ```
   */
  media: {
    upload: (args: UploadMediaArgs) => Promise<MediaFile>;
    find: (args?: FindMediaArgs) => Promise<PaginatedResponse<MediaFile>>;
    findByID: (args: FindMediaByIDArgs) => Promise<MediaFile | null>;
    update: (args: UpdateMediaArgs) => Promise<MediaFile>;
    delete: (args: DeleteMediaArgs) => Promise<DeleteResult>;
    bulkDelete: (args: BulkDeleteMediaArgs) => Promise<BulkOperationResult>;
    folders: {
      list: (args?: ListFoldersArgs) => Promise<MediaFolder[]>;
      create: (args: CreateFolderArgs) => Promise<MediaFolder>;
    };
  };

  /**
   * Forms API namespace - operations for forms and form submissions.
   *
   * Provides direct database operations for form management without HTTP overhead.
   * Requires the `@revnixhq/plugin-form-builder` plugin to be installed.
   *
   * @example
   * ```typescript
   * const nextly = await getNextly(config);
   *
   * // List published forms
   * const forms = await nextly.forms.find({ status: 'published' });
   *
   * // Get form by slug
   * const form = await nextly.forms.findBySlug({ slug: 'contact-form' });
   *
   * // Submit form data
   * const result = await nextly.forms.submit({
   *   form: 'contact-form',
   *   data: { name: 'John', email: 'john@example.com', message: 'Hello!' },
   * });
   *
   * // Get submissions
   * const submissions = await nextly.forms.submissions({
   *   form: 'contact-form',
   *   limit: 20,
   * });
   * ```
   */
  forms: {
    find: (
      args?: FindFormsArgs
    ) => Promise<PaginatedResponse<Record<string, unknown>>>;
    findBySlug: (
      args: FindFormBySlugArgs
    ) => Promise<Record<string, unknown> | null>;
    submit: (args: SubmitFormArgs) => Promise<SubmitFormResult>;
    submissions: (
      args: FormSubmissionsArgs
    ) => Promise<PaginatedResponse<Record<string, unknown>>>;
  };

  /**
   * Media service - direct access to MediaService for advanced operations.
   *
   * For most use cases, prefer the `media` namespace above which provides
   * a simplified CRUD API. Use this for advanced operations like
   * image processing, storage checks, etc.
   *
   * @example
   * ```typescript
   * const nextly = await getNextly(config);
   *
   * // Check storage type
   * const storageType = nextly.mediaService.getStorageType();
   *
   * // Move media to folder
   * await nextly.mediaService.moveToFolder('media-id', 'folder-id', context);
   * ```
   */
  mediaService: ServiceMap["mediaService"];

  /**
   * Storage manager - manage file storage with collection-specific routing.
   *
   * Provides access to storage operations with support for:
   * - Collection-specific storage backends (S3, Vercel Blob, local)
   * - Client-side upload URL generation
   * - Signed download URLs for private files
   *
   * @example
   * ```typescript
   * const nextly = await getNextly(config);
   *
   * // Upload with collection routing
   * const result = await nextly.storage.upload(buffer, {
   *   filename: 'photo.jpg',
   *   mimeType: 'image/jpeg',
   *   collection: 'media'
   * });
   *
   * // Get client upload URL (bypasses server for large files)
   * const uploadData = await nextly.storage.getClientUploadUrl(
   *   'video.mp4',
   *   'video/mp4',
   *   'media'
   * );
   *
   * // Get signed URL for private file access
   * const signedUrl = await nextly.storage.getSignedDownloadUrl(
   *   'private/doc.pdf',
   *   'private-docs',
   *   3600 // expires in 1 hour
   * );
   * ```
   */
  storage: ServiceMap["mediaStorage"];

  /**
   * Database adapter - direct access to the database layer.
   *
   * Provides low-level database operations for advanced use cases.
   * Most applications should use the service APIs instead.
   *
   * @example
   * ```typescript
   * const nextly = await getNextly(config);
   *
   * // Check capabilities
   * const caps = nextly.adapter.getCapabilities();
   * console.log('JSONB support:', caps.supportsJsonb);
   *
   * // Run raw query (advanced)
   * const results = await nextly.adapter.select('custom_table', {
   *   where: { status: 'active' }
   * });
   * ```
   */
  adapter: DrizzleAdapter;

  // ==========================================================================
  // Email Provider Namespace
  // ==========================================================================

  emailProviders: {
    find: (
      args?: FindEmailProvidersArgs
    ) => Promise<PaginatedResponse<EmailProviderRecord>>;
    findByID: (
      args: FindEmailProviderByIDArgs
    ) => Promise<EmailProviderRecord | null>;
    create: (args: CreateEmailProviderArgs) => Promise<EmailProviderRecord>;
    update: (args: UpdateEmailProviderArgs) => Promise<EmailProviderRecord>;
    delete: (args: DeleteEmailProviderArgs) => Promise<DeleteResult>;
    setDefault: (args: SetDefaultProviderArgs) => Promise<EmailProviderRecord>;
    test: (
      args: TestEmailProviderArgs
    ) => Promise<{ success: boolean; error?: string }>;
  };

  // ==========================================================================
  // Email Template Namespace
  // ==========================================================================

  emailTemplates: {
    find: (
      args?: FindEmailTemplatesArgs
    ) => Promise<PaginatedResponse<EmailTemplateRecord>>;
    findByID: (
      args: FindEmailTemplateByIDArgs
    ) => Promise<EmailTemplateRecord | null>;
    findBySlug: (
      args: FindEmailTemplateBySlugArgs
    ) => Promise<EmailTemplateRecord | null>;
    create: (args: CreateEmailTemplateArgs) => Promise<EmailTemplateRecord>;
    update: (args: UpdateEmailTemplateArgs) => Promise<EmailTemplateRecord>;
    delete: (args: DeleteEmailTemplateArgs) => Promise<DeleteResult>;
    preview: (
      args: PreviewEmailTemplateArgs
    ) => Promise<{ subject: string; html: string }>;
    getLayout: (
      args?: GetEmailLayoutArgs
    ) => Promise<{ header: string; footer: string }>;
    updateLayout: (args: UpdateEmailLayoutArgs) => Promise<void>;
  };

  // ==========================================================================
  // User Field Definition Namespace
  // ==========================================================================

  userFields: {
    find: (
      args?: FindUserFieldsArgs
    ) => Promise<PaginatedResponse<UserFieldDefinitionRecord>>;
    findByID: (
      args: FindUserFieldByIDArgs
    ) => Promise<UserFieldDefinitionRecord | null>;
    create: (args: CreateUserFieldArgs) => Promise<UserFieldDefinitionRecord>;
    update: (args: UpdateUserFieldArgs) => Promise<UserFieldDefinitionRecord>;
    delete: (args: DeleteUserFieldArgs) => Promise<DeleteResult>;
    reorder: (
      args: ReorderUserFieldsArgs
    ) => Promise<UserFieldDefinitionRecord[]>;
  };

  // ==========================================================================
  // Email Send Namespace
  // ==========================================================================

  email: {
    send: (args: SendEmailArgs) => Promise<SendEmailResult>;
    sendWithTemplate: (args: SendTemplateEmailArgs) => Promise<SendEmailResult>;
  };

  // ==========================================================================
  // Roles Namespace
  // ==========================================================================

  /**
   * Roles API namespace - CRUD operations for RBAC roles.
   *
   * @example
   * ```typescript
   * const nextly = await getNextly(config);
   *
   * // List roles
   * const roles = await nextly.roles.find({ limit: 20 });
   *
   * // Get role by ID
   * const role = await nextly.roles.findByID({ id: 'role-123' });
   *
   * // Create a role
   * const editor = await nextly.roles.create({
   *   data: { name: 'Editor', slug: 'editor', level: 10 },
   * });
   *
   * // Assign permissions to a role
   * await nextly.roles.setPermissions({
   *   id: editor.id,
   *   permissionIds: ['perm-1', 'perm-2'],
   * });
   * ```
   */
  roles: {
    find: (args?: FindRolesArgs) => Promise<PaginatedResponse<Role>>;
    findByID: (args: FindRoleByIDArgs) => Promise<Role>;
    create: (args: CreateRoleArgs) => Promise<Role>;
    update: (args: UpdateRoleArgs) => Promise<Role>;
    delete: (args: DeleteRoleArgs) => Promise<DeleteResult>;
    getPermissions: (args: GetRolePermissionsArgs) => Promise<Permission[]>;
    setPermissions: (args: SetRolePermissionsArgs) => Promise<Permission[]>;
  };

  // ==========================================================================
  // Permissions Namespace
  // ==========================================================================

  /**
   * Permissions API namespace - CRUD operations for RBAC permissions.
   *
   * @example
   * ```typescript
   * const nextly = await getNextly(config);
   *
   * // List all permissions
   * const perms = await nextly.permissions.find({ resource: 'posts' });
   *
   * // Create a permission
   * const perm = await nextly.permissions.create({
   *   data: { name: 'Publish Posts', slug: 'publish-posts', action: 'update', resource: 'posts' },
   * });
   * ```
   */
  permissions: {
    find: (
      args?: FindPermissionsArgs
    ) => Promise<PaginatedResponse<Permission>>;
    findByID: (args: FindPermissionByIDArgs) => Promise<Permission | null>;
    create: (args: CreatePermissionArgs) => Promise<Permission>;
    delete: (args: DeletePermissionArgs) => Promise<void>;
  };

  // ==========================================================================
  // Access Namespace
  // ==========================================================================

  /**
   * Access namespace - programmatic access control evaluation.
   *
   * @example
   * ```typescript
   * const nextly = await getNextly(config);
   *
   * // Check if a user can read posts
   * const canRead = await nextly.access.check({
   *   userId: 'user-123',
   *   resource: 'posts',
   *   operation: 'read',
   * });
   * ```
   */
  access: {
    check: (args: CheckAccessArgs) => Promise<boolean>;
  };

  /**
   * Shutdown the Nextly instance and clean up resources.
   *
   * This will:
   * - Disconnect the database adapter
   * - Clear the service container
   * - Reset the cached instance
   *
   * After calling this, the next call to `getNextly()` will create
   * a new instance.
   *
   * @example
   * ```typescript
   * const nextly = await getNextly(config);
   *
   * // When shutting down
   * await nextly.shutdown();
   * ```
   */
  shutdown: () => Promise<void>;
}
