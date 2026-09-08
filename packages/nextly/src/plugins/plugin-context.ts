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
import {
  createJobsNamespace,
  type JobsNamespace,
} from "../direct-api/namespaces/jobs";
import type { SingleRegistryService } from "../domains/singles/services/single-registry-service";
import type { VersionsService } from "../domains/versions/versions-service";
import type { EventBus, EventHandler, EventName } from "../events/event-bus";
import { getEventBus } from "../events/event-bus";
import type { Action, Filter } from "../filters";
import { getFilterRegistry } from "../filters";
import type {
  BeforeOperationHandler,
  HookContextPhase,
  HookHandler,
  HookOwner,
} from "../hooks/types";
import type { CollectionService } from "../services/collections/collection-service";
import type { EmailService } from "../services/email/email-service";
import type { MediaService } from "../services/media/media-service";
import type { Logger } from "../services/shared";
import type { UserService } from "../services/users/user-service";
import type { DatabaseInstance } from "../types/database-operations";

import type { AdminPlacement } from "./admin-placement";
import type { PluginContributions } from "./contributions";
import { getCoreVersion } from "./core-version";
import type { PluginCategory } from "./plugin-categories";
import { wrapSinglesForPlugin } from "./plugin-singles";
import type { PluginSinglesService } from "./plugin-singles";
import type { PluginSelf } from "./self";
import { resolvePluginSelf } from "./self";
import {
  wrapCollectionsForPlugin,
  type PluginCollectionService,
} from "./service-opts";
import { buildPluginServicesNamespace } from "./services/plugin-services-registry";
import { recordPluginSubscription } from "./subscription-tracker";

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
   *
   * @typeParam T - The document shape. Pass it to get a typed `context.data`
   *   instead of casting — prefer this over `as unknown as`:
   * ```typescript
   * interface Post { id: string; title: string; status: string }
   * nextly.hooks.on<Post>('beforeCreate', 'posts', (context) => {
   *   // context.data is typed Post — no cast needed
   *   if (context.data?.status === 'published') { ... }
   *   return context.data;
   * });
   * ```
   */
  on<T = unknown>(
    hookType: HookContextPhase,
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
    hookType: HookContextPhase,
    collection: string,
    handler: HookHandler<T>
  ): void;

  /**
   * Register a `beforeOperation` hook.
   *
   * Separate from {@link on} because the handler is shaped differently: it
   * receives the operation's `args` -- the data, id or where clause about to be
   * used -- rather than a document, and returning a modified set replaces them.
   *
   * @param collection - Collection name or '*' for all collections
   * @param handler - Hook function to execute
   *
   * @example
   * ```typescript
   * nextly.hooks.onBeforeOperation('posts', (context) => {
   *   if (context.operation === 'read') {
   *     return { ...context.args, where: { ...context.args.where, archived: false } };
   *   }
   * });
   * ```
   */
  onBeforeOperation<T = unknown>(
    collection: string,
    handler: BeforeOperationHandler<T>
  ): void;

  /**
   * Unregister a `beforeOperation` hook, the counterpart to
   * {@link onBeforeOperation}.
   *
   * @param collection - Collection name or '*'
   * @param handler - The exact handler function to remove
   */
  offBeforeOperation<T = unknown>(
    collection: string,
    handler: BeforeOperationHandler<T>
  ): void;
}

/**
 * @experimental Typed filter registry exposed to plugins.
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
 * @experimental Typed action registry exposed to plugins.
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
 * import { definePlugin, NextlyError } from '@nextlyhq/plugin-sdk';
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
 *         // A NextlyError, not a plain one: a plain Error reads as a crash and
 *         // its message is replaced before the caller sees it.
 *         throw NextlyError.validation({
 *           errors: [
 *             { path: 'authorId', code: 'NOT_FOUND', message: 'Author not found.' },
 *           ],
 *         });
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
   * @public Core services with full TypeScript autocomplete — the managed,
   * secure-by-default data path. Prefer this over `ctx.db`.
   *
   * Provides access to the unified service layer for:
   * - Collections: CRUD operations on dynamic collections
   * - Users: User management and authentication
   * - Media: File upload and management
   */
  services: {
    /**
     * Collection service for CRUD on dynamic collections. Access methods accept
     * `ServiceOpts` (`as`/`user`) — secure-by-default; no-user runs as system.
     */
    collections: PluginCollectionService;
    /** User service for user management */
    users: UserService;
    /** Media service for file operations */
    media: MediaService;
    /** Email service for sending emails via templates and providers */
    email: EmailService;
    /**
     * @experimental Read-only content version history (list/get). Restore and
     * diff arrive in later stages.
     */
    versions: VersionsService;
    /**
     * @experimental Read-only registry access to the app's Singles: which are
     * declared, and what fields they have.
     *
     * The counterpart to `collections` for the other kind of content. Without
     * it a plugin can enumerate collections and is simply blind to Singles, so
     * anything that sweeps the app's documents silently covers half of it —
     * which is how a usage index reports a class as unreferenced while a
     * homepage still renders it.
     *
     * Addressed by SLUG, because a Single's row may not exist until something
     * writes to it. Listing creates nothing; see `plugin-singles`.
     */
    singles: PluginSinglesService;
    /**
     * @experimental Queue background work — `ctx.services.jobs.queue({...})`.
     *
     * Declaring a job type is `defineJob` in `contributes.jobs`; this is how a
     * plugin asks for one of them to happen.
     */
    jobs: JobsNamespace;
    /**
     * @experimental Services contributed by plugins, keyed by plugin name
     * then service name. Lazily resolved (instantiated on first access). Runtime
     * type is `unknown` — cast to your service's type, or export it from the
     * providing plugin.
     */
    plugins: Record<string, Record<string, unknown>>;
  };

  /**
   * @experimental Raw Drizzle database instance — the full escape hatch.
   * Unmanaged: bypasses validation/hooks/RBAC/events. Prefer `services`.
   */
  db: DatabaseInstance;

  /** @experimental Logger for plugin diagnostics. */
  logger: Logger;

  /**
   * @public Post-commit, observe-only, best-effort event bus.
   * Use a hook to modify/abort; use an event to react/notify.
   */
  events: EventBus;

  /**
   * @experimental Running Nextly core version, for feature-detection.
   * e.g. "0.0.2-alpha.21".
   */
  nextlyVersion: string;

  /**
   * @experimental Resolved names for this plugin's own entities. Read
   * `ctx.self.collections[...]` instead of hardcoding slugs so the P2 remap can
   * rename them transparently. Identity-resolved.
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
   * @experimental Hook registration for lifecycle events. Allows plugins to
   * register hooks that run before/after database operations on collections.
   * No first-party plugin registers via `ctx.hooks` yet (see STABILITY.md).
   */
  hooks: PluginHookRegistry;

  /** @experimental Typed filter registry. Transform values at named seams. */
  filters: PluginFilterRegistry;

  /** @experimental Typed action registry. Ordered side-effects at named seams. */
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
  /**
   * URL of an image the plugin ships, for a plugin that wants its own branding
   * rather than a built-in glyph. Takes precedence over `icon` where both are
   * declared, and the admin scales it rather than cropping, so a rectangular
   * logo keeps its proportions.
   *
   * `icon` remains the common case: a lucide name is theme-aware by
   * construction, while an image has to work on both the light and the dark
   * surface on its own.
   */
  iconAsset?: string;
  /** Custom label override (defaults to plugin name) */
  label?: string;
  /** Badge text shown next to the plugin name (e.g., "Beta", "New") */
  badge?: string;
  /** Badge variant for styling */
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
}

/**
 * Controlled vocabulary for the admin plugins list's category filter.
 *
 * Defined in `./plugin-categories`, which has no imports so the admin can take
 * it from `nextly/config` without the plugin runtime. Re-exported here because
 * this is the module a plugin author already imports to declare one.
 */
export {
  PLUGIN_CATEGORIES,
  isPluginCategory,
  type PluginCategory,
} from "./plugin-categories";

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
   * Required so that other plugins' `dependsOn` ranges can be checked.
   */
  version: string;

  /**
   * @public Author shown in the admin plugins list (a person or an
   * organization). Convention: mirror the package.json `author` value.
   */
  author?: string;

  /**
   * @public Homepage URL, linked from the admin plugin detail page.
   * Convention: mirror the package.json `homepage` value.
   */
  homepage?: string;

  /**
   * @public Source repository URL, linked from the admin plugin detail page.
   * Convention: mirror the package.json `repository` URL.
   */
  repository?: string;

  /**
   * @public Documentation URL, when the docs live somewhere other than the
   * homepage. Omit if `homepage` already points at the docs.
   */
  docsUrl?: string;

  /**
   * @public SPDX license identifier (e.g. `"MIT"`), shown on the admin plugin
   * detail page. Convention: mirror the package.json `license` value.
   */
  license?: string;

  /**
   * @public Category the admin plugins list groups and filters by.
   * A controlled vocabulary rather than free text so filtering stays useful.
   */
  category?: PluginCategory;

  /**
   * @public Free-form descriptive tags, shown on the admin plugin detail
   * page. Unlike `category` these are not used for filtering.
   */
  tags?: string[];

  /**
   * @public Core-compatibility range, boot-checked. May span majors,
   * e.g. `'^1 || ^2'`. Prereleases (alpha/beta) count as in-range.
   */
  nextly: string;

  /**
   * @experimental Required plugin dependencies → version range.
   * Plugins are topologically sorted so dependencies initialize first.
   */
  dependsOn?: Record<string, string>;

  /**
   * @experimental Enhance-if-present dependencies → version range.
   * Absent optional deps are fine; present-but-incompatible fails fast.
   */
  optionalDependsOn?: Record<string, string>;

  /**
   * @experimental Default `true`. `false` skips behavior (init/hooks/events/
   * routes/admin) but STILL applies declarative schema. Behavior-skip is
   * wired.
   */
  enabled?: boolean;

  /**
   * @public Declarative contributions — introspectable without running
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
   * `contributes.admin`: `admin` = placement & appearance; `contributes.admin`
   * = the declarative menu/pages/settings/views surface. Both are retained.
   */
  admin?: PluginAdminConfig;

  /**
   * @public Escape-hatch config transformer; all `setup`s run before any
   * `init`. Don't mutate the config — spread and return a new object.
   *
   * @param config - Current configuration
   * @returns Modified configuration
   */
  setup?: (config: NextlyServiceConfig) => NextlyServiceConfig;

  /**
   * @public Plugin initialization function.
   *
   * Called after all services are registered.
   * Receives PluginContext for service access and hook registration.
   *
   * @param context - PluginContext with services, db, logger, events, config, hooks
   */
  init?: (context: PluginContext) => Promise<void> | void;

  /**
   * @public Teardown on shutdown / HMR / test teardown.
   * Invocation is wired.
   */
  destroy?: (context: PluginContext) => Promise<void> | void;

  /**
   * @experimental Framework-owned entity remap. Rename this plugin's
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
    // Framework remap: returns a NEW definition with the rename map
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
 *
 * @internal Core wiring, not an entry point for plugin authors. The DI
 * container and the auth deps bridge build a context; a plugin receives one.
 * It is absent from `@nextlyhq/plugin-sdk` and from that package's
 * STABILITY.md for that reason.
 *
 * `getServiceFn` is typed from {@link PLUGIN_SERVICE_NAMES}, so a resolver must
 * answer every name in that list.
 */
/**
 * Every service name `createPluginContext` may ask its resolver for.
 *
 * Declared once and consumed by both the context and its resolver, so the two
 * cannot disagree about what may be asked for. A resolver missing a name here
 * fails to compile; without the shared list it would instead throw
 * `Unknown service` at runtime, and nothing earlier would catch it — the
 * resolver reaches `createPluginContext` through a cast, so the compiler cannot
 * check it, and `ctx.services` members are getters, so enumerating the object
 * reports a name without ever invoking it.
 */
export const PLUGIN_SERVICE_NAMES = [
  "collectionService",
  "userService",
  "mediaService",
  "emailService",
  "versionsService",
  "singleRegistryService",
  "db",
  "logger",
  "config",
] as const;

/** One of the names a plugin-context resolver must answer. */
export type PluginServiceName = (typeof PLUGIN_SERVICE_NAMES)[number];

export function createPluginContext(
  getServiceFn: <T extends PluginServiceName>(
    name: T
  ) => T extends "collectionService"
    ? CollectionService
    : T extends "userService"
      ? UserService
      : T extends "mediaService"
        ? MediaService
        : T extends "emailService"
          ? EmailService
          : T extends "versionsService"
            ? VersionsService
            : T extends "singleRegistryService"
              ? SingleRegistryService
              : T extends "db"
                ? DatabaseInstance
                : T extends "logger"
                  ? Logger
                  : T extends "config"
                    ? NextlyServiceConfig
                    : never,
  hookRegistry: {
    register: (
      hookType: HookContextPhase,
      collection: string,
      handler: HookHandler,
      owner?: HookOwner
    ) => void;
    unregister: (
      hookType: HookContextPhase,
      collection: string,
      handler: HookHandler,
      owner?: HookOwner
    ) => void;
    registerBeforeOperation: (
      collection: string,
      handler: BeforeOperationHandler,
      owner?: HookOwner
    ) => void;
    unregisterBeforeOperation: (
      collection: string,
      handler: BeforeOperationHandler,
      owner?: HookOwner
    ) => void;
  },
  /**
   * The plugin this context is built for — used to resolve `ctx.self`.
   * Optional so the factory stays usable without a plugin (empty `self`).
   */
  plugin?: PluginDefinition
): PluginContext {
  // Subscriptions made through this context are tracked under the plugin's name
  // so the runtime can clear them before the plugin re-initializes on HMR (B2).
  const pluginName = plugin?.name;

  // Everything registered through this context is attributed to the plugin, so
  // a config reload can rebuild the config's own handlers without deleting a
  // plugin's -- the form builder registers its `afterRead` straight into the
  // `forms` namespace, and nothing would put that back. A context built without
  // a plugin has no identity to attribute to and keeps the registry's default.
  const hookOwner: HookOwner | undefined = pluginName
    ? `plugin:${pluginName}`
    : undefined;

  // Create simplified hook registry for plugins
  const pluginHooks: PluginHookRegistry = {
    on: (hookType, collection, handler) => {
      hookRegistry.register(
        hookType,
        collection,
        handler as HookHandler,
        hookOwner
      );
      if (pluginName) {
        recordPluginSubscription(pluginName, () =>
          hookRegistry.unregister(
            hookType,
            collection,
            handler as HookHandler,
            hookOwner
          )
        );
      }
    },
    off: (hookType, collection, handler) => {
      hookRegistry.unregister(
        hookType,
        collection,
        handler as HookHandler,
        hookOwner
      );
    },
    onBeforeOperation: (collection, handler) => {
      hookRegistry.registerBeforeOperation(collection, handler, hookOwner);
      if (pluginName) {
        recordPluginSubscription(pluginName, () =>
          hookRegistry.unregisterBeforeOperation(collection, handler, hookOwner)
        );
      }
    },
    offBeforeOperation: (collection, handler) => {
      hookRegistry.unregisterBeforeOperation(collection, handler, hookOwner);
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
  const rawBus = getEventBus();
  rawBus.setLogger(logger);
  // Per-plugin event bus: `on()` also records an unsubscribe thunk so the
  // runtime can clear this plugin's subscriptions before it re-initializes on
  // HMR (B2). Every other method delegates to the shared bus unchanged.
  const events: EventBus = pluginName
    ? new Proxy(rawBus, {
        get(target, prop) {
          if (prop === "on") {
            return (name: EventName, handler: EventHandler) => {
              target.on(name, handler);
              recordPluginSubscription(pluginName, () =>
                target.off(name, handler)
              );
            };
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    : rawBus;

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
      // Resolved on access, not at construction: `createPluginContext` is
      // exported, and a resolver written before this service existed would
      // otherwise throw while building the context for callers that never
      // touch version history.
      get versions() {
        return getServiceFn("versionsService");
      },
      // Lazy for the same reason as `versions` directly above: this module is
      // exported, so a context built by a caller that never asks about Singles
      // must not require the registry to have been resolved first.
      get singles() {
        return wrapSinglesForPlugin(getServiceFn("singleRegistryService"));
      },
      // Queueing work for later. Lazy like its neighbours above and for the same
      // reason: this module is exported, so a context built by a caller that
      // never queues a job must not require the runner to be resolved first.
      //
      // Reached through `ctx.services` rather than by re-exporting the Direct
      // API from the SDK. A plugin that declares a job type with `defineJob`
      // needs somewhere to ASK for one; without this the only route was
      // importing the core `nextly` entry directly, crossing the boundary the
      // SDK exists to draw.
      get jobs() {
        return createJobsNamespace();
      },
      plugins: buildPluginServicesNamespace(),
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
