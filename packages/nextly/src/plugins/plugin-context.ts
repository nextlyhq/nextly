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
import type { EventBus } from "../events/event-bus";
import { getEventBus } from "../events/event-bus";
import type { Action, Filter } from "../filters";
import { getFilterRegistry } from "../filters";
import type { HookHandler, HookType } from "../hooks/types";
import type { CollectionService } from "../services/collections/collection-service";
import type { EmailService } from "../services/email/email-service";
import type { MediaService } from "../services/media/media-service";
import type { Logger } from "../services/shared";
import type { UserService } from "../services/users/user-service";
import type { DatabaseInstance } from "../types/database-operations";

import type { AdminPlacement } from "./admin-placement";
import type { PluginContributions } from "./contributions";
import { getCoreVersion } from "./core-version";
import type { PluginSelf } from "./self";
import { resolvePluginSelf } from "./self";
import {
  wrapCollectionsForPlugin,
  type PluginCollectionService,
} from "./service-opts";

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
 *       nextly.logger.info(`Created ${context.collection}:${context.data?.id}`);
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

/**
 * @experimental Typed filter registry exposed to plugins (D63).
 * Register transforms on named seams, or define + apply your own seams.
 */
export interface PluginFilterRegistry {
  add<V = unknown, C = unknown>(name: string, fn: Filter<V, C>): void;
  remove<V = unknown, C = unknown>(name: string, fn: Filter<V, C>): void;
  apply<V = unknown, C = unknown>(
    name: string,
    value: V,
    context: C
  ): Promise<V>;
}

/**
 * @experimental Typed action registry exposed to plugins (D63).
 * Register ordered, error-isolated side-effects on named seams, or run your own.
 */
export interface PluginActionRegistry {
  add<P = unknown, C = unknown>(name: string, fn: Action<P, C>): void;
  remove<P = unknown, C = unknown>(name: string, fn: Action<P, C>): void;
  run<P = unknown, C = unknown>(
    name: string,
    payload: P,
    context: C
  ): Promise<void>;
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
 * The context provides:
 * - `services`: Core business logic services (collections, users, media, email)
 * - `db` / `logger`: Raw database escape hatch + diagnostics logger
 * - `events`: Post-commit, observe-only event bus
 * - `self` / `nextlyVersion`: Resolved own-entity names + core version
 * - `config`: Read-only configuration
 * - `hooks`: Hook registration for lifecycle events
 *
 * @example
 * ```typescript
 * import { definePlugin } from 'nextly';
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
 *     nextly.logger.info('MyPlugin initialized');
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
    /**
     * Collection service for CRUD on dynamic collections. Access methods accept
     * `ServiceOpts` (`as`/`user`) — secure-by-default; no-user runs as system (D35).
     */
    collections: PluginCollectionService;
    /** User service for user management */
    users: UserService;
    /** Media service for file operations */
    media: MediaService;
    /** Email service for sending emails via templates and providers */
    email: EmailService;
  };

  /**
   * @experimental Raw Drizzle database instance — the full escape hatch (D33).
   * Unmanaged: bypasses validation/hooks/RBAC/events. Prefer `services`.
   */
  db: DatabaseInstance;

  /** @experimental Logger for plugin diagnostics. */
  logger: Logger;

  /**
   * @experimental Post-commit, observe-only, best-effort event bus (D8/D51).
   * Use a hook to modify/abort; use an event to react/notify.
   */
  events: EventBus;

  /**
   * @experimental Running Nextly core version, for feature-detection (D6).
   * e.g. "0.0.2-alpha.21".
   */
  nextlyVersion: string;

  /**
   * @experimental Resolved names for this plugin's own entities (D54). Read
   * `ctx.self.collections[...]` instead of hardcoding slugs so the P2 remap can
   * rename them transparently. Identity-resolved in P1.
   */
  self: PluginSelf;

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

  /** @experimental Typed filter registry (D63). Transform values at named seams. */
  filters: PluginFilterRegistry;

  /** @experimental Typed action registry (D63). Ordered side-effects at named seams. */
  actions: PluginActionRegistry;
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
 * import { definePlugin, AdminPlacement } from 'nextly';
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
   * - `AdminPlacement.COLLECTIONS` (Collections section)
   * - `AdminPlacement.SINGLES` (Singles section)
   * - `AdminPlacement.USERS` (Users inner sidebar)
   * - `AdminPlacement.SETTINGS` (Settings inner sidebar)
   * - `AdminPlacement.PLUGINS` (Plugins section, default)
   *
   * If not set, falls back to `"plugins"`.
   */
  placement?: AdminPlacement;

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
 * import { definePlugin } from 'nextly';
 *
 * export const auditLogPlugin = definePlugin({
 *   name: 'audit-log',
 *   version: '1.0.0',
 *
 *   async init(nextly) {
 *     // Log all create/update/delete operations
 *     const logOperation = async (context) => {
 *       nextly.logger.info('Audit', {
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
   * Plugin semver version.
   * Required so that other plugins' `dependsOn` ranges can be checked (D5/D39).
   */
  version: string;

  /**
   * @experimental Core-compatibility range, boot-checked (D6). May span majors,
   * e.g. `'^1 || ^2'`. Prereleases (alpha/beta) count as in-range.
   */
  nextly: string;

  /**
   * @experimental Required plugin dependencies → version range (D5).
   * Plugins are topologically sorted so dependencies initialize first.
   */
  dependsOn?: Record<string, string>;

  /**
   * @experimental Enhance-if-present dependencies → version range (D5).
   * Absent optional deps are fine; present-but-incompatible fails fast.
   */
  optionalDependsOn?: Record<string, string>;

  /**
   * @experimental Default `true`. `false` skips behavior (init/hooks/events/
   * routes/admin) but STILL applies declarative schema (D49). Behavior-skip is
   * wired in P1.
   */
  enabled?: boolean;

  /**
   * @experimental Declarative contributions (D1) — introspectable without running
   * the plugin. Consumed incrementally by later phases. See {@link PluginContributions}.
   */
  contributes?: PluginContributions;

  /**
   * Collections provided by this plugin.
   *
   * @deprecated Prefer `contributes.collections` (wired by the schema pipeline in
   * P2). Still read by the admin sidebar (routeHandler) — kept for backward
   * compatibility and merged today via the plugin's own `setup` transformer.
   */
  collections?: CollectionConfig[];

  /**
   * Admin configuration for sidebar placement and plugin metadata.
   *
   * Controls where the plugin's items appear in the sidebar (placement/order)
   * and its appearance + settings-page blurb. This is **complementary** to
   * `contributes.admin` (P5): `admin` = placement & appearance; `contributes.admin`
   * = the declarative menu/pages/settings/views surface. Both are retained.
   */
  admin?: PluginAdminConfig;

  /**
   * @experimental Escape-hatch config transformer; all `setup`s run before any
   * `init` (D4). Don't mutate the config — spread and return a new object.
   *
   * @param config - Current configuration
   * @returns Modified configuration
   */
  setup?: (config: NextlyServiceConfig) => NextlyServiceConfig;

  /**
   * Plugin initialization function.
   *
   * Called after all services are registered.
   * Receives PluginContext for service access and hook registration.
   *
   * @param context - PluginContext with services, db, logger, events, config, hooks
   */
  init?: (context: PluginContext) => Promise<void> | void;

  /**
   * @experimental Teardown on shutdown / HMR / test teardown (D4).
   * Invocation is wired in P1.
   */
  destroy?: (context: PluginContext) => Promise<void> | void;

  /**
   * @experimental Framework-owned entity remap (D54). Rename this plugin's
   * contributed entity slugs at registration — declared slug → new slug — to
   * avoid collisions or match house naming. Returns a NEW definition; the
   * plugin keeps working because it references its own entities via `ctx.self`.
   *
   * @example
   * ```ts
   * defineConfig({ plugins: [formBuilder().plugin.rename({ forms: "contact-forms" })] })
   * ```
   */
  rename?: (map: Record<string, string>) => PluginDefinition;

  /**
   * @internal Accumulated declared-slug → new-slug map from `rename()`.
   * Consumed by the schema fold (renames merged slugs + the plugin's own
   * `relationTo`) and by `resolvePluginSelf` (builds `ctx.self`). Not for
   * plugin authors to set directly.
   */
  renameMap?: Record<string, string>;
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
 * import { definePlugin } from 'nextly';
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
  const withRename: PluginDefinition = {
    ...definition,
    // Framework remap (D54): returns a NEW definition with the rename map
    // merged. The original is left untouched (pure); chainable.
    rename(map: Record<string, string>): PluginDefinition {
      return definePlugin({
        ...withRename,
        renameMap: { ...(withRename.renameMap ?? {}), ...map },
      });
    },
  };
  return withRename;
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
 * import { getService, getHookRegistry } from 'nextly';
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
  },
  /**
   * The plugin this context is built for — used to resolve `ctx.self` (D54).
   * Optional so the factory stays usable without a plugin (empty `self`).
   */
  plugin?: PluginDefinition
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

  // Route isolated event-handler diagnostics through the resolved logger.
  const events = getEventBus();
  events.setLogger(logger);

  const filterRegistry = getFilterRegistry();
  filterRegistry.setLogger(logger);
  const pluginFilters: PluginFilterRegistry = {
    add: (name, fn) => filterRegistry.addFilter(name, fn),
    remove: (name, fn) => filterRegistry.removeFilter(name, fn),
    apply: (name, value, context) =>
      filterRegistry.applyFilters(name, value, context),
  };
  const pluginActions: PluginActionRegistry = {
    add: (name, fn) => filterRegistry.addAction(name, fn),
    remove: (name, fn) => filterRegistry.removeAction(name, fn),
    run: (name, payload, context) =>
      filterRegistry.runActions(name, payload, context),
  };

  return {
    services: {
      collections: wrapCollectionsForPlugin(collectionService),
      users: userService,
      media: mediaService,
      email: emailService,
    },
    db,
    logger,
    events,
    nextlyVersion: getCoreVersion(),
    self: plugin
      ? resolvePluginSelf(plugin)
      : { name: "", collections: {}, singles: {} },
    config: Object.freeze({ ...config }),
    hooks: pluginHooks,
    filters: pluginFilters,
    actions: pluginActions,
  };
}
