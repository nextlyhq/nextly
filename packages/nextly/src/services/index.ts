import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { getDialectTables } from "../database/index";
import { container } from "../di/container";

import { AuthService } from "./auth/auth-service";
import { PermissionCheckerService } from "./auth/permission-checker-service";
import { PermissionService } from "./auth/permission-service";
import { RoleInheritanceService } from "./auth/role-inheritance-service";
import { RolePermissionService } from "./auth/role-permission-service";
import { RoleService } from "./auth/role-service";
import { UserRoleService } from "./auth/user-role-service";
import { CollectionsHandler } from "./collections-handler";
import { MediaService as LegacyMediaService } from "./media";
import { MediaFolderService } from "./media-folder";
import { UsersService } from "./users";

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

export { RoleQueryService, RoleMutationService } from "./auth/role/index";

export { RoleService } from "./auth/role-service";
export { PermissionService } from "./auth/permission-service";
export { RolePermissionService } from "./auth/role-permission-service";
export { UserRoleService } from "./auth/user-role-service";
export { RoleInheritanceService } from "./auth/role-inheritance-service";
export { PermissionCheckerService } from "./auth/permission-checker-service";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly db: any;

  constructor(private readonly adapter: DrizzleAdapter) {
    this.tables = getDialectTables(adapter.getCapabilities().dialect);
    this.db = adapter.getDrizzle(this.tables as Record<string, unknown>);
  }

  private getLogger(): import("./shared").Logger {
    return container.has("logger")
      ? container.get<import("./shared").Logger>("logger")
      : (console as unknown as import("./shared").Logger);
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
        ? container.get<
            import("./users/user-ext-schema-service").UserExtSchemaService
          >("userExtSchemaService")
        : undefined;
      const config = container.has("config")
        ? container.get<import("../di/register").NextlyServiceConfig>("config")
        : undefined;
      const emailService = container.has("emailService")
        ? container.get<import("./email/email-service").EmailService>(
            "emailService"
          )
        : undefined;
      const logger = container.has("logger")
        ? container.get<import("./shared").Logger>("logger")
        : (console as unknown as import("./shared").Logger);
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
        ? container.get<import("./email/email-service").EmailService>(
            "emailService"
          )
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
          const handler = container.get("collectionsHandler") as
            | CollectionsHandler
            | undefined;
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
      this._media = new LegacyMediaService(this.adapter, this.getLogger());
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
