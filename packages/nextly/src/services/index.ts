import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getDialectTables } from "../database/index";
import { resolveRelations } from "../database/resolve-relations";
import { container } from "../di/container";
import type { NextlyServiceConfig } from "../di/register";
import { AuthService } from "../domains/auth/services/auth-service";
import { PermissionCheckerService } from "../domains/auth/services/permission-checker-service";
import { PermissionService } from "../domains/auth/services/permission-service";
import { RoleInheritanceService } from "../domains/auth/services/role-inheritance-service";
import { RolePermissionService } from "../domains/auth/services/role-permission-service";
import { RoleService } from "../domains/auth/services/role-service";
import { UserRoleService } from "../domains/auth/services/user-role-service";
import type { WebhookFastDrainScheduler } from "../domains/webhooks/after-drain";
import type { DatabaseInstance } from "../types/database-operations";

import { CollectionsHandler } from "./collections-handler";
import type { EmailService } from "./email/email-service";
import { MediaService as LegacyMediaService } from "./media";
import { MediaFolderService } from "./media-folder";
import type { Logger } from "./shared";
import { UsersService } from "./users";
import type { UserExtSchemaService } from "./users/user-ext-schema-service";

export { CollectionService } from "./collections";
export type {
  Collection,
  CreateCollectionInput,
  UpdateCollectionInput,
  ListCollectionsOptions,
  CollectionEntry as CollectionDocument,
} from "./collections";

export { CollectionRegistryService } from "./collections";
export type {
  UpdateCollectionOptions,
  CodeFirstCollectionConfig,
  SyncResult,
  RegistryListOptions,
} from "./collections";

export { UserService } from "./users/user-service";
export type {
  User,
  CreateUserInput,
  UpdateUserInput,
  PasswordHasher,
} from "./users/user-service";

export { MediaService } from "./media/media-service";
export type {
  MediaFile,
  UploadMediaInput,
  UpdateMediaInput,
  ListMediaOptions,
  MediaFolder,
  CreateFolderInput,
  UpdateFolderInput,
  FolderContents,
  BulkOperationResult,
} from "./media/media-service";

export { UploadService } from "./upload-service";
export type {
  UploadConfig,
  UploadOptions as UploadFileOptions,
  UploadedFile,
  UploadServiceResult,
} from "./upload-service";

export type { IStorageAdapter as StorageProvider } from "../storage/types";

export * from "./shared";

export * from "./base-service";
export * from "./users";
export * from "./dispatcher";
export * from "../domains/dynamic-collections";
export * from "./collection-file-manager";
export * from "./collections-handler";

export {
  CollectionMetadataService,
  CollectionEntryService,
  CollectionRelationshipService,
} from "./collections/index";

export {
  UserQueryService,
  UserMutationService,
  UserAccountService,
} from "./users/index";

export {
  DynamicCollectionValidationService,
  DynamicCollectionSchemaService,
  DynamicCollectionRegistryService,
} from "../domains/dynamic-collections";

export {
  RoleQueryService,
  RoleMutationService,
} from "../domains/auth/services/role/index";

export { RoleService } from "../domains/auth/services/role-service";
export { PermissionService } from "../domains/auth/services/permission-service";
export { RolePermissionService } from "../domains/auth/services/role-permission-service";
export { UserRoleService } from "../domains/auth/services/user-role-service";
export { RoleInheritanceService } from "../domains/auth/services/role-inheritance-service";
export { PermissionCheckerService } from "../domains/auth/services/permission-checker-service";

export {
  SystemTableService,
  type SystemTableStatus,
  type SystemTableInitResult,
  type SystemMigrationSQL,
} from "./system";

export {
  calculateSchemaHash,
  schemaHashesMatch,
  hasSchemaChanged,
} from "../domains/schema/services/schema-hash";

export { AccessControlService } from "./access";
export type {
  AccessRuleType,
  AccessOperation,
  StoredAccessRule,
  CollectionAccessRules,
  AccessEvaluationResult,
  CustomAccessFunction,
} from "./access";

export {
  ACCESS_RULE_TYPES,
  ACCESS_OPERATIONS,
  DEFAULT_OWNER_FIELD,
} from "./access";

// Legacy - prefer MediaService from "./media/media-service" for new code.
export { MediaService as LegacyMediaService } from "./media";
export { MediaFolderService } from "./media-folder";

/**
 * Service container providing dependency injection for Nextly services.
 *
 * Centralizes service instantiation with consistent db and tables injection.
 * Services are lazily instantiated to avoid unnecessary overhead.
 */
export class ServiceContainer {
  private _users?: UsersService;
  private _auth?: AuthService;
  private _collections?: CollectionsHandler;

  private _roles?: RoleService;
  private _permissions?: PermissionService;
  private _rolePermissions?: RolePermissionService;
  private _userRoles?: UserRoleService;
  private _roleInheritance?: RoleInheritanceService;
  private _permissionChecker?: PermissionCheckerService;

  private _media?: LegacyMediaService;
  private _mediaFolders?: MediaFolderService;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly tables: any;
  constructor(private readonly adapter: DrizzleAdapter) {
    const dialect = adapter.getCapabilities().dialect;
    this.tables = getDialectTables(dialect);
  }

  // v1: db.query is powered by the relations config (defineRelations).
  // Resolved lazily and on EVERY access via resolveRelations — never
  // captured at construction — so (a) containers built for a single
  // transaction or upload never pay drizzle construction they don't use,
  // and (b) a SchemaRegistry invalidation propagates instead of freezing
  // whichever snapshot existed when the container was built. The adapter
  // memoizes per relations object, so this is two map lookups when
  // nothing changed. Typed as DatabaseInstance — the shape its one
  // consumer (CollectionsHandler) declares.
  private get db(): DatabaseInstance {
    const dialect = this.adapter.getCapabilities().dialect;
    return this.adapter.getDrizzle<DatabaseInstance>(resolveRelations(dialect));
  }

  private getLogger(): Logger {
    return container.has("logger") ? container.get<Logger>("logger") : console;
  }

  /**
   * Check if adapter is configured
   */
  get hasAdapter(): boolean {
    return !!this.adapter;
  }

  /**
   * Get Users service instance (lazy-loaded)
   * Injects UserExtSchemaService, UserConfig, and EmailService from DI container if available.
   */
  get users(): UsersService {
    if (!this._users) {
      const userExtSchemaService = container.has("userExtSchemaService")
        ? container.get<UserExtSchemaService>("userExtSchemaService")
        : undefined;
      const config = container.has("config")
        ? container.get<NextlyServiceConfig>("config")
        : undefined;
      const emailService = container.has("emailService")
        ? container.get<EmailService>("emailService")
        : undefined;
      const logger = container.has("logger")
        ? container.get<Logger>("logger")
        : (console as unknown as Logger);
      this._users = new UsersService(
        this.adapter,
        logger,
        config?.users,
        userExtSchemaService,
        emailService
      );
    }
    return this._users;
  }

  /**
   * Get Auth service instance (lazy-loaded)
   * Injects EmailService from DI container if available.
   */
  get auth(): AuthService {
    if (!this._auth) {
      const emailService = container.has("emailService")
        ? container.get<EmailService>("emailService")
        : undefined;
      const logger = this.getLogger();

      this._auth = new AuthService(this.adapter, logger, emailService);
    }
    return this._auth;
  }

  /**
   * Get Collections handler instance (lazy-loaded)
   *
   * IMPORTANT: This getter first checks the DI container for a registered
   * CollectionsHandler. This ensures that dynamic schemas registered via
   * getCollectionsHandler() are available to the ServiceDispatcher.
   *
   * @throws Error if adapter was not provided and DI container has no handler
   */
  get collections(): CollectionsHandler {
    if (!this._collections) {
      // First, try to get from DI container (ensures dynamic schemas are shared)
      try {
        if (container.has("collectionsHandler")) {
          const handler = container.get<CollectionsHandler | undefined>(
            "collectionsHandler"
          );
          if (handler) {
            this._collections = handler;
            return this._collections;
          }
        }
      } catch {
        // DI not initialized, fall through to create new instance
      }

      if (!this.adapter) {
        throw new Error(
          "CollectionsHandler requires an adapter. Use new ServiceContainer(db, adapter) or use " +
            "the DI container pattern with registerServices() instead."
        );
      }
      this._collections = new CollectionsHandler(this.adapter, this.db);
    }
    return this._collections;
  }

  /**
   * Get Role service instance (lazy-loaded)
   * Handles role CRUD operations
   */
  get roles(): RoleService {
    if (!this._roles) {
      this._roles = new RoleService(this.adapter, this.getLogger());
    }
    return this._roles;
  }

  /**
   * Get Permission service instance (lazy-loaded)
   * Handles permission CRUD operations
   */
  get permissions(): PermissionService {
    if (!this._permissions) {
      this._permissions = new PermissionService(this.adapter, this.getLogger());
    }
    return this._permissions;
  }

  /**
   * Get RolePermission service instance (lazy-loaded)
   * Handles role-permission assignments
   */
  get rolePermissions(): RolePermissionService {
    if (!this._rolePermissions) {
      this._rolePermissions = new RolePermissionService(
        this.adapter,
        this.getLogger()
      );
    }
    return this._rolePermissions;
  }

  /**
   * Get UserRole service instance (lazy-loaded)
   * Handles user-role assignments
   */
  get userRoles(): UserRoleService {
    if (!this._userRoles) {
      this._userRoles = new UserRoleService(this.adapter, this.getLogger());
    }
    return this._userRoles;
  }

  /**
   * Get RoleInheritance service instance (lazy-loaded)
   * Handles role hierarchy management
   */
  get roleInheritance(): RoleInheritanceService {
    if (!this._roleInheritance) {
      this._roleInheritance = new RoleInheritanceService(
        this.adapter,
        this.getLogger()
      );
    }
    return this._roleInheritance;
  }

  /**
   * Get PermissionChecker service instance (lazy-loaded)
   * Handles authorization checking logic
   */
  get permissionChecker(): PermissionCheckerService {
    if (!this._permissionChecker) {
      this._permissionChecker = new PermissionCheckerService(
        this.adapter,
        this.getLogger()
      );
    }
    return this._permissionChecker;
  }

  /**
   * Get Media service instance (lazy-loaded)
   * Handles media file uploads, processing, and storage
   */
  get media(): LegacyMediaService {
    if (!this._media) {
      // Server actions reach media through this container rather than the
      // unified media service, so inject the shared drain fast path directly —
      // otherwise action-driven media events would sit in the outbox until the
      // scheduled drain (which also owns retention pruning). Resolved from DI
      // when the app has booted webhooks; a bare container (e.g. a CLI/test
      // build) gets none and simply relies on the scheduled drain.
      const fastDrainScheduler = container.has("webhookFastDrainScheduler")
        ? container.get<WebhookFastDrainScheduler>("webhookFastDrainScheduler")
        : undefined;
      this._media = new LegacyMediaService(
        this.adapter,
        this.getLogger(),
        fastDrainScheduler
      );
    }
    return this._media;
  }

  /**
   * Get MediaFolder service instance (lazy-loaded)
   * Handles folder organization for media files
   */
  get mediaFolders(): MediaFolderService {
    if (!this._mediaFolders) {
      this._mediaFolders = new MediaFolderService(
        this.adapter,
        this.getLogger()
      );
    }
    return this._mediaFolders;
  }

  /**
   * Get tables for current dialect (public accessor)
   */
  get dialectTables(): unknown {
    return this.tables;
  }

  /**
   * Execute a function within a database transaction with fresh service instances.
   * Creates new service instances with transaction context for use within the transaction.
   *
   * @param fn Function to execute within transaction, receives fresh service container with tx context
   * @returns Promise resolving to the function's return value
   */
  async withTransaction<T>(
    fn: (txServices: ServiceContainer) => Promise<T>
  ): Promise<T> {
    return this.adapter.transaction(async () => {
      const txServices = new ServiceContainer(this.adapter);
      return fn(txServices);
    });
  }
}
