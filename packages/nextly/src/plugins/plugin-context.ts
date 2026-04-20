/**
 * Plugin Context System
 *
 * Provides a type-safe context for plugins to access Nextly services.
 * Plugins receive this context during initialization, enabling them
 * to interact with core services and register hooks.
 *
 * @module plugins/plugin-context
 * @since 1.0.0
 */

import type { CollectionConfig } from "../collections/config/define-collection";
import type { NextlyServiceConfig } from "../di/register";
import type { HookHandler, HookType } from "../hooks/types";
import type { CollectionService } from "../services/collections/collection-service";
import type { EmailService } from "../services/email/email-service";
import type { MediaService } from "../services/media/media-service";
import type { Logger } from "../services/shared";
import type { UserService } from "../services/users/user-service";
import type { DatabaseInstance } from "../types/database-operations";

import type { AdminPlacement } from "./admin-placement";

// ============================================================
// Plugin Hook Registry Interface
// ============================================================

/**
 * Simplified hook registry interface for plugins.
 *
 * Provides only the methods plugins should use (register/unregister hooks).
 * Internal methods like `execute()` and `clear()` are not exposed.
 *
 * @example
 * ```typescript
 * export const myPlugin = definePlugin({
 *   name: 'my-plugin',
 *
 *   async init(nextly) {
 *     // Register a beforeCreate hook
 *     nextly.hooks.on('beforeCreate', 'posts', async (context) => {
 *       context.data.slug = slugify(context.data.title);
 *       return context.data;
 *     });
 *
 *     // Register a global hook (all collections)
 *     nextly.hooks.on('afterCreate', '*', async (context) => {
 *       nextly.infra.logger.info(`Created ${context.collection}:${context.data?.id}`);
 *     });
 *   }
 * });
 * ```
 */
export interface PluginHookRegistry {
  /**
   * Register a hook for a specific collection and hook type.
   *
   * @param hookType - Type of hook (beforeCreate, afterCreate, etc.)
   * @param collection - Collection name or '*' for global hooks
   * @param handler - Hook function to execute
   *
   * @example
   * ```typescript
   * // Collection-specific hook
   * nextly.hooks.on('beforeCreate', 'users', async (context) => {
   *   context.data.password = await bcrypt.hash(context.data.password, 10);
   *   return context.data;
   * });
   *
   * // Global hook (runs for all collections)
   * nextly.hooks.on('afterDelete', '*', async (context) => {
   *   console.log(`Deleted from ${context.collection}`);
   * });
   * ```
   */
  on<T = unknown>(
    hookType: HookType,
    collection: string,
    handler: HookHandler<T>
  ): void;

  /**
   * Unregister a previously registered hook.
   *
   * @param hookType - Type of hook
   * @param collection - Collection name or '*'
   * @param handler - The exact handler function to remove
   *
   * @example
   * ```typescript
   * const myHook = async (context) => { ... };
   *
   * // Register
   * nextly.hooks.on('beforeCreate', 'posts', myHook);
   *
   * // Later, unregister
   * nextly.hooks.off('beforeCreate', 'posts', myHook);
   * ```
   */
  off<T = unknown>(
    hookType: HookType,
    collection: string,
    handler: HookHandler<T>
  ): void;
}

// ============================================================
// Plugin Context Interface
// ============================================================

/**
 * PluginContext - Type-safe context for plugin service access.
 *
 * Plugins receive this context during initialization, providing
 * access to all Nextly services and infrastructure.
 *
 * The context is organized into logical groups:
 * - `services`: Core business logic services (collections, users, media)
 * - `infra`: Infrastructure components (database, logger)
 * - `config`: Read-only configuration
 * - `hooks`: Hook registration for lifecycle events
 *
 * @example
 * ```typescript
 * import { definePlugin } from '@revnixhq/nextly';
 *
 * export const myPlugin = definePlugin({
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *
 *   async init(nextly) {
 *     // Access services with full TypeScript autocomplete
 *     const { collections, users, media } = nextly.services;
 *
 *     // Register hooks
 *     nextly.hooks.on('beforeCreate', 'posts', async (context) => {
 *       // Validate that author exists
 *       const author = await users.findById(context.data.authorId, {});
 *       if (!author) {
 *         throw new Error('Author not found');
 *       }
 *       return context.data;
 *     });
 *
 *     // Use infrastructure
 *     nextly.infra.logger.info('MyPlugin initialized');
 *   }
 * });
 * ```
 */
export interface PluginContext {
  /**
   * Core services with full TypeScript autocomplete.
   *
   * Provides access to the unified service layer for:
   * - Collections: CRUD operations on dynamic collections
   * - Users: User management and authentication
   * - Media: File upload and management
   */
  services: {
    /** Collection service for CRUD operations on dynamic collections */
    collections: CollectionService;
    /** User service for user management */
    users: UserService;
    /** Media service for file operations */
    media: MediaService;
    /** Email service for sending emails via templates and providers */
    email: EmailService;
  };

  /**
   * Infrastructure access.
   *
   * Provides access to low-level infrastructure:
   * - Database: Direct Drizzle database access (use with caution)
   * - Logger: Logging interface for plugin diagnostics
   */
  infra: {
    /** Drizzle database instance for direct queries */
    db: DatabaseInstance;
    /** Logger for plugin diagnostics */
    logger: Logger;
  };

  /**
   * Read-only configuration.
   *
   * Contains the Nextly service configuration.
   * Configuration is frozen to prevent accidental modification.
   */
  config: Readonly<NextlyServiceConfig>;

  /**
   * Hook registration for lifecycle events.
   *
   * Allows plugins to register hooks that run before/after
   * database operations on collections.
   */
  hooks: PluginHookRegistry;
}

// ============================================================
// Plugin Admin Appearance Interface
// ============================================================

/**
 * Sidebar appearance customization for plugins.
 *
 * Allows plugin authors to customize how their plugin appears
 * in the admin sidebar. All fields are optional — unset fields
 * use sensible defaults (Package icon, plugin name as label).
 *
 * @example
 * ```typescript
 * admin: {
 *   appearance: {
 *     icon: "BarChart",       // Lucide icon name
 *     label: "Analytics",     // Custom sidebar label
 *     badge: "Beta",          // Badge text
 *     badgeVariant: "secondary",
 *   },
 * }
 * ```
 */
export interface PluginAdminAppearance {
  /** Lucide icon name for the plugin's sidebar entry */
  icon?: string;
  /** Custom label override (defaults to plugin name) */
  label?: string;
  /** Badge text shown next to the plugin name (e.g., "Beta", "New") */
  badge?: string;
  /** Badge variant for styling */
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
}

// ============================================================
// Plugin Admin Config Interface
// ============================================================

/**
 * Plugin admin configuration for sidebar placement and appearance.
 *
 * Allows plugins to declare their sidebar placement, sort order,
 * appearance customization, and description for the plugin settings page.
 *
 * @example
 * ```typescript
 * import { definePlugin, AdminPlacement } from '@revnixhq/nextly';
 *
 * export const analyticsPlugin = definePlugin({
 *   name: 'Analytics Dashboard',
 *   admin: {
 *     placement: AdminPlacement.USERS,
 *     order: 60,
 *     description: 'User analytics and insights',
 *     appearance: {
 *       icon: 'BarChart',
 *       label: 'Analytics',
 *       badge: 'Beta',
 *       badgeVariant: 'secondary',
 *     },
 *   },
 * });
 * ```
 */
export interface PluginAdminConfig {
  /**
   * Immutable sidebar placement for this plugin's items.
   *
   * Use `AdminPlacement` constants for TypeScript autocomplete:
   * - `AdminPlacement.COLLECTIONS` — Collections section
   * - `AdminPlacement.SINGLES` — Singles section
   * - `AdminPlacement.USERS` — Users inner sidebar
   * - `AdminPlacement.SETTINGS` — Settings inner sidebar
   * - `AdminPlacement.PLUGINS` — Plugins section (default)
   *
   * If not set, falls back to `group` (deprecated) then `"plugins"`.
   */
  placement?: AdminPlacement;

  /**
   * Default sidebar group for this plugin's items.
   *
   * @deprecated Use `placement` with `AdminPlacement` constants instead.
   * This field is kept for backward compatibility. Resolution order:
   * `host override > placement > group > "plugins"`.
   */
  group?: string;

  /** Sort order when placed in a group (lower = higher position, default: 100) */
  order?: number;

  /**
   * Position anchor for standalone plugins.
   * Specifies which built-in sidebar section this plugin's icon appears after.
   *
   * Valid values: `"dashboard"` | `"collections"` | `"singles"` | `"media"` | `"plugins"` | `"users"`
   *
   * Only applies when `placement` is `AdminPlacement.STANDALONE`.
   * If multiple standalone plugins share the same `after`, they are sorted by `order`.
   * Defaults to `"plugins"` (after the Plugins icon).
   *
   * @example
   * ```ts
   * admin: {
   *   placement: AdminPlacement.STANDALONE,
   *   after: "collections", // icon appears right after Collections
   *   order: 10,
   * }
   * ```
   */
  after?:
    | "dashboard"
    | "collections"
    | "singles"
    | "media"
    | "plugins"
    | "users"
    | "settings";

  /** Plugin description shown on the plugin settings page */
  description?: string;

  /** Sidebar appearance customization (icon, label, badge) */
  appearance?: PluginAdminAppearance;
}

// ============================================================
// Plugin Definition Interface
// ============================================================

/**
 * Plugin definition interface.
 *
 * Defines the structure of a Nextly plugin. Plugins can:
 * - Initialize with access to PluginContext
 * - Transform configuration before services are registered
 *
 * @example
 * ```typescript
 * import { definePlugin } from '@revnixhq/nextly';
 *
 * export const auditLogPlugin = definePlugin({
 *   name: 'audit-log',
 *   version: '1.0.0',
 *
 *   async init(nextly) {
 *     // Log all create/update/delete operations
 *     const logOperation = async (context) => {
 *       nextly.infra.logger.info('Audit', {
 *         collection: context.collection,
 *         operation: context.operation,
 *         user: context.user?.id,
 *         timestamp: new Date().toISOString(),
 *       });
 *     };
 *
 *     nextly.hooks.on('afterCreate', '*', logOperation);
 *     nextly.hooks.on('afterUpdate', '*', logOperation);
 *     nextly.hooks.on('afterDelete', '*', logOperation);
 *   }
 * });
 * ```
 */
export interface PluginDefinition {
  /**
   * Unique plugin name.
   * Used for identification and error messages.
   */
  name: string;

  /**
   * Plugin version (semver format recommended).
   * Helps with debugging and compatibility checks.
   */
  version?: string;

  /**
   * Collections provided by this plugin.
   *
   * These collections are automatically merged with user collections
   * in defineConfig(). Users don't need to manually spread plugin collections.
   *
   * @example
   * ```typescript
   * // Plugin definition
   * const myPlugin: PluginDefinition = {
   *   name: 'my-plugin',
   *   collections: [FormsCollection, SubmissionsCollection],
   * };
   *
   * // User config - collections are auto-merged
   * export default defineConfig({
   *   plugins: [myPlugin],
   *   collections: [Posts, Users], // Plugin collections added automatically
   * });
   * ```
   */
  collections?: CollectionConfig[];

  /**
   * Admin configuration for sidebar placement and plugin metadata.
   *
   * Controls where the plugin's items appear in the sidebar
   * and provides metadata for the plugin settings page.
   */
  admin?: PluginAdminConfig;

  /**
   * Plugin initialization function.
   *
   * Called after all services are registered.
   * Receives PluginContext for service access and hook registration.
   *
   * @param context - PluginContext with services, infra, config, hooks
   */
  init?: (context: PluginContext) => Promise<void> | void;

  /**
   * Configuration transformer (advanced).
   *
   * Allows plugins to modify the config before service initialization.
   * Use with caution - this runs before services are available.
   *
   * @param config - Current configuration
   * @returns Modified configuration
   */
  config?: (config: NextlyServiceConfig) => NextlyServiceConfig;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Define a plugin with type safety.
 *
 * This is a helper function that provides TypeScript autocomplete
 * when defining plugins. It simply returns the definition as-is.
 *
 * @param definition - Plugin definition
 * @returns The same definition (for type inference)
 *
 * @example
 * ```typescript
 * import { definePlugin } from '@revnixhq/nextly';
 *
 * export const myPlugin = definePlugin({
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *
 *   async init(nextly) {
 *     // Full TypeScript autocomplete available
 *     nextly.services.collections.listCollections();
 *   }
 * });
 * ```
 */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition;
}

/**
 * Create a PluginContext from the DI container.
 *
 * This factory function creates a PluginContext by retrieving
 * services from the container. It should be called after
 * `registerServices()` has been invoked.
 *
 * The config is frozen to prevent accidental modification.
 *
 * @param getServiceFn - Function to get services from container
 * @param hookRegistry - Hook registry for plugin hook registration
 * @returns Fully initialized PluginContext
 *
 * @example
 * ```typescript
 * import { getService, getHookRegistry } from '@revnixhq/nextly';
 *
 * // Create context for plugin initialization
 * const context = createPluginContext(getService, getHookRegistry());
 *
 * // Initialize plugins
 * for (const plugin of plugins) {
 *   await plugin.init?.(context);
 * }
 * ```
 */
export function createPluginContext(
  getServiceFn: <
    T extends
      | "collectionService"
      | "userService"
      | "mediaService"
      | "emailService"
      | "db"
      | "logger"
      | "config",
  >(
    name: T
  ) => T extends "collectionService"
    ? CollectionService
    : T extends "userService"
      ? UserService
      : T extends "mediaService"
        ? MediaService
        : T extends "emailService"
          ? EmailService
          : T extends "db"
            ? DatabaseInstance
            : T extends "logger"
              ? Logger
              : T extends "config"
                ? NextlyServiceConfig
                : never,
  hookRegistry: {
    register: (
      hookType: HookType,
      collection: string,
      handler: HookHandler
    ) => void;
    unregister: (
      hookType: HookType,
      collection: string,
      handler: HookHandler
    ) => void;
  }
): PluginContext {
  // Create simplified hook registry for plugins
  const pluginHooks: PluginHookRegistry = {
    on: (hookType, collection, handler) => {
      hookRegistry.register(hookType, collection, handler as HookHandler);
    },
    off: (hookType, collection, handler) => {
      hookRegistry.unregister(hookType, collection, handler as HookHandler);
    },
  };

  // Retrieve services from container
  const collectionService = getServiceFn("collectionService");
  const userService = getServiceFn("userService");
  const mediaService = getServiceFn("mediaService");
  const emailService = getServiceFn("emailService");
  const db = getServiceFn("db");
  const logger = getServiceFn("logger");
  const config = getServiceFn("config");

  return {
    services: {
      collections: collectionService,
      users: userService,
      media: mediaService,
      email: emailService,
    },
    infra: {
      db,
      logger,
    },
    config: Object.freeze({ ...config }) as Readonly<NextlyServiceConfig>,
    hooks: pluginHooks,
  };
}
