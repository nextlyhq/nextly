/**
 * Nextly Initialization
 *
 * This module provides the main entry point for initializing and accessing
 * Nextly services. `getNextly()` is the primary API, providing a cached
 * singleton instance.
 *
 * The bulky pieces that used to live here have been extracted:
 *
 * - The public `Nextly` interface is defined in `./init/nextly-instance.ts`
 * - `runPostInitTasks()` lives in `./init/post-init-tasks.ts`
 * - `buildServiceConfig()` and `GetNextlyOptions` live in
 *   `./init/build-service-config.ts`
 *
 * All of those names are re-exported from this module so existing
 * imports (`import { Nextly } from "@revnixhq/nextly"`, etc.) keep working.
 *
 * @example
 * ```typescript
 * import { getNextly } from '@revnixhq/nextly';
 *
 * // In your API route or server component
 * export async function GET() {
 *   const nextly = await getNextly({
 *     storage: myStorageAdapter,
 *     imageProcessor: myImageProcessor,
 *   });
 *
 *   const posts = await nextly.collections.find('posts', {}, context);
 *   return Response.json({ posts });
 * }
 * ```
 */

import type { SanitizedNextlyConfig } from "./collections/config/define-config";
import {
  getService,
  isServicesRegistered,
  registerServices,
  shutdownServices,
} from "./di/register";
import { getNextly as getDirectAPI } from "./direct-api/nextly";
import {
  buildServiceConfig,
  type GetNextlyOptions,
} from "./init/build-service-config";
import type { Nextly } from "./init/nextly-instance";
import { runPostInitTasks } from "./init/post-init-tasks";
import { reloadNextlyConfig } from "./init/reload-config";
// HMR listener primitives (F1 PR 2). Lazy WS setup inside getNextly()
// detects code-first config edits and flips a reload flag; the next
// getNextly() call drains the flag, calls reloadNextlyConfig, and then
// returns the cached instance with refreshed schema state.
import {
  ensureHmrListener,
  consumeHmrReloadFlag,
  markHmrReloadInFlight,
} from "./runtime/hmr-listener";

// ============================================================
// Re-exports
// ============================================================

/**
 * Re-export the Nextly instance type so all existing `import { Nextly }`
 * paths keep working after the interface was moved to `./init/nextly-instance`.
 */
export type { Nextly } from "./init/nextly-instance";
export type { GetNextlyOptions } from "./init/build-service-config";
/**
 * Re-export NextlyServiceConfig type for convenience.
 * This allows users to import from '@revnixhq/nextly' instead of 'nextly/di'.
 */
export type { NextlyServiceConfig } from "./di/register";

// ============================================================
// Singleton Cache
// ============================================================

/**
 * Cached Nextly instance.
 * Instance is created once and reused.
 * Stored on globalThis to survive ESM module duplication in Next.js/Turbopack.
 *
 * __nextly_initPromise deduplicates concurrent getNextly() calls: all callers
 * that arrive while initialization is in progress receive the same Promise,
 * preventing multiple simultaneous database connections (which causes ETIMEDOUT
 * storms against cloud databases such as Neon that auto-suspend).
 */
const globalForInit = globalThis as unknown as {
  __nextly_cachedInstance?: Nextly | null;
  __nextly_initPromise?: Promise<Nextly> | null;
};

// ============================================================
// Main API
// ============================================================

/**
 * Get or initialize the Nextly instance.
 *
 * This function is cached - subsequent calls return the same instance.
 * This is the recommended way to access Nextly in your application.
 *
 * **Configuration Loading:**
 * If no config is provided, or if storage plugins are not specified,
 * Nextly will automatically load `nextly.config.ts` from your project root
 * and use the storage plugins defined there.
 *
 * **Environment Variables Used:**
 * - `DB_DIALECT`: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - `DATABASE_URL`: Database connection string
 *
 * **Behavior:**
 * - First call: Initializes services, connects to database, logs capabilities
 * - Subsequent calls: Returns cached instance immediately (no overhead)
 *
 * @param options - Optional configuration for Nextly services. If not provided,
 *                 configuration will be loaded from nextly.config.ts
 * @returns Nextly instance with access to all services
 *
 * @example
 * ```typescript
 * import { getNextly } from '@revnixhq/nextly';
 *
 * // Simplest usage - config loaded from nextly.config.ts
 * export async function GET(req: Request) {
 *   const nextly = await getNextly();
 *   const posts = await nextly.collections.find('posts', {}, context);
 *   return Response.json({ posts });
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With explicit config (overrides nextly.config.ts)
 * import { getNextly } from '@revnixhq/nextly';
 * import { s3Storage } from '@revnixhq/storage-s3';
 *
 * const nextly = await getNextly({
 *   storagePlugins: [
 *     s3Storage({
 *       bucket: process.env.S3_BUCKET!,
 *       region: process.env.AWS_REGION!,
 *       collections: { media: true }
 *     })
 *   ]
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With custom adapter
 * import { createAdapter, getNextly } from '@revnixhq/nextly';
 *
 * const adapter = await createAdapter({
 *   type: 'postgresql',
 *   url: 'postgres://localhost/mydb'
 * });
 *
 * const nextly = await getNextly({ adapter });
 * ```
 */
export async function getNextly(options?: GetNextlyOptions): Promise<Nextly> {
  // Fast path: return already-initialised instance immediately.
  if (globalForInit.__nextly_cachedInstance) {
    // F1 PR 2: drain HMR reload flag before returning cached instance.
    // If the user edited nextly.config.ts since the last getNextly call,
    // the WebSocket onmessage handler set the flag; we now reload the
    // config and apply safe schema deltas. Destructive deltas log a
    // warning and are skipped (see reload-config.ts safety stance).
    if (consumeHmrReloadFlag()) {
      const reloadPromise = reloadNextlyConfig();
      markHmrReloadInFlight(reloadPromise);
      await reloadPromise;
    }
    // Even with cached instance, check if we need to register storage plugins.
    // This handles the case where services were initialised before config was
    // available (e.g. different Next.js worker process, or env vars not loaded
    // at init time).
    if (options?.config?.storage && options.config.storage.length > 0) {
      const mediaStorage = getService("mediaStorage");
      // Check if storage has any adapters configured
      if (!mediaStorage.hasAdapter()) {
        // Register the storage plugins from config
        for (const plugin of options.config.storage) {
          mediaStorage.registerPlugin(plugin);
        }
        console.log(
          `[Nextly] Late-registered ${options.config.storage.length} storage plugin(s)`
        );
      }
    }
    return globalForInit.__nextly_cachedInstance;
  }

  // Deduplication path: if another call already started initialisation, wait
  // for the same Promise instead of starting a second one.  This prevents the
  // concurrent-connection storm that causes ETIMEDOUT against cloud databases
  // (e.g. Neon) that auto-suspend between requests.
  if (globalForInit.__nextly_initPromise) {
    return globalForInit.__nextly_initPromise;
  }

  // Begin first-time initialisation and store the Promise so concurrent calls
  // above return it rather than spawning duplicate DB connections.
  const initPromise = (async (): Promise<Nextly> => {
    try {
      if (!isServicesRegistered()) {
        // Build final config from provided options
        const finalConfig = buildServiceConfig(options);

        await registerServices(finalConfig);

        // Log capabilities on first initialisation
        const adapter = getService("adapter");
        const capabilities = adapter.getCapabilities();

        console.log(`Nextly initialized with ${capabilities.dialect} database`);
        console.log(`  - JSONB support: ${capabilities.supportsJsonb}`);
        console.log(`  - RETURNING support: ${capabilities.supportsReturning}`);
        console.log(`  - Full-text search: ${capabilities.supportsFts}`);

        // Run post-initialisation tasks (template seeding, code-field sync,
        // permission seeding, etc.) in the background so that getNextly()
        // returns as soon as the DB connection is ready.  All tasks are
        // idempotent and their errors are already caught internally, so
        // firing without await is safe.
        void runPostInitTasks();
      }

      // Get the Direct API instance
      const directAPI = getDirectAPI();

      // Build and cache the instance
      const instance: Nextly = {
        // Direct API methods
        find: directAPI.find.bind(directAPI),
        findByID: directAPI.findByID.bind(directAPI),
        create: directAPI.create.bind(directAPI),
        update: directAPI.update.bind(directAPI),
        delete: directAPI.delete.bind(directAPI),
        count: directAPI.count.bind(directAPI),
        bulkDelete: directAPI.bulkDelete.bind(directAPI),
        duplicate: directAPI.duplicate.bind(directAPI),
        findGlobal: directAPI.findGlobal.bind(directAPI),
        updateGlobal: directAPI.updateGlobal.bind(directAPI),
        findGlobals: directAPI.findGlobals.bind(directAPI),

        // Authentication methods
        login: directAPI.login.bind(directAPI),
        logout: directAPI.logout.bind(directAPI),
        me: directAPI.me.bind(directAPI),
        updateMe: directAPI.updateMe.bind(directAPI),
        register: directAPI.register.bind(directAPI),
        changePassword: directAPI.changePassword.bind(directAPI),
        forgotPassword: directAPI.forgotPassword.bind(directAPI),
        resetPassword: directAPI.resetPassword.bind(directAPI),
        verifyEmail: directAPI.verifyEmail.bind(directAPI),

        // Users API namespace (Direct API style)
        users: directAPI.users,

        // Media API namespace (Direct API style)
        media: directAPI.media,

        // Forms API namespace (Direct API style)
        forms: directAPI.forms,

        // Email & User Field namespaces (Plan 12)
        emailProviders: directAPI.emailProviders,
        emailTemplates: directAPI.emailTemplates,
        userFields: directAPI.userFields,
        email: directAPI.email,

        // RBAC namespaces (Plan 13)
        roles: directAPI.roles,
        permissions: directAPI.permissions,
        access: directAPI.access,

        // Service accessors
        collections: getService("collectionService"),
        userService: getService("userService"),
        mediaService: getService("mediaService"),
        storage: getService("mediaStorage"),

        // Direct adapter access
        adapter: getService("adapter"),

        // Shutdown method
        shutdown: async () => {
          await shutdownServices();
          globalForInit.__nextly_cachedInstance = null;
          console.log("Nextly shutdown complete");
        },
      };

      globalForInit.__nextly_cachedInstance = instance;

      // F1 PR 2: open the HMR WebSocket lazily after first init succeeds.
      // ensureHmrListener is idempotent and gated on NODE_ENV / the
      // NEXTLY_DISABLE_HMR escape hatch, so this is safe to call here
      // even when the consumer is running tests or in production.
      ensureHmrListener();

      return instance;
    } finally {
      // Always clear the in-flight promise so future calls use the cached
      // instance (or retry on failure).
      globalForInit.__nextly_initPromise = null;
    }
  })();

  // Publish the Promise before we await it so any concurrent getNextly()
  // calls that arrive while we are still in registerServices() will join
  // this Promise rather than starting a new one.
  globalForInit.__nextly_initPromise = initPromise;

  return initPromise;
}

/**
 * Create a Next.js instrumentation `register` function for Nextly.
 *
 * This is the recommended way to initialize Nextly via Next.js's
 * `instrumentation.ts` hook, which runs **once** in each server worker
 * process before the first request is handled.  Calling `getNextly()`
 * here warms up the database connection and registers storage/plugins so
 * that the first page request never pays the cold-start penalty.
 *
 * @param config - Pre-loaded Nextly configuration from `nextly.config.ts`.
 *                 Pass the default export of your config file so storage
 *                 plugins and collections are registered on startup.
 * @returns An async `register()` function that satisfies the Next.js
 *          instrumentation contract.
 *
 * @example
 * ```typescript
 * // instrumentation.ts  (project root)
 * import { createRegister } from '@revnixhq/nextly';
 * import nextlyConfig from './nextly.config';
 *
 * export const register = createRegister(nextlyConfig);
 * ```
 */
export function createRegister(
  config: SanitizedNextlyConfig
): () => Promise<void> {
  return async function register() {
    await getNextly({ config });
  };
}

/**
 * Shutdown the Nextly instance and clean up resources.
 *
 * This will:
 * - Disconnect the database adapter
 * - Clear all service registrations
 * - Reset the cached Nextly instance
 *
 * After calling this, the next call to `getNextly()` will create
 * a new instance with fresh connections.
 *
 * **Use Cases:**
 * - Application shutdown (SIGTERM/SIGINT handlers)
 * - Testing (reset between tests)
 * - Hot reload scenarios
 *
 * @example
 * ```typescript
 * // Graceful shutdown on process signals
 * process.on('SIGTERM', async () => {
 *   await shutdownNextly();
 *   process.exit(0);
 * });
 *
 * process.on('SIGINT', async () => {
 *   await shutdownNextly();
 *   process.exit(0);
 * });
 * ```
 *
 * @example
 * ```typescript
 * // In tests
 * afterEach(async () => {
 *   await shutdownNextly();  // Clean up between tests
 * });
 *
 * test('creates a post', async () => {
 *   const nextly = await getNextly(testConfig);
 *   const post = await nextly.collections.create('posts', data, context);
 *   expect(post).toBeDefined();
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Using the instance method
 * const nextly = await getNextly(config);
 *
 * // Later...
 * await nextly.shutdown();  // Or use shutdownNextly()
 * ```
 */
export async function shutdownNextly(): Promise<void> {
  if (globalForInit.__nextly_cachedInstance) {
    await globalForInit.__nextly_cachedInstance.shutdown();
  }
}
