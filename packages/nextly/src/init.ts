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
// Imported here (not lazy) because bumpSchemaVersion is tiny and used in the
// IPC server onApplied callback set up during init. Lazy-loading it adds no
// value for a non-heavy module.
import { bumpSchemaVersion } from "./routeHandler";

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
  // Task 11: IPC server handle when running under the nextly dev wrapper.
  // Exposed on globalThis so other modules (e.g. the collection dispatcher
  // apply handler) can push apply-requests into the same dispatcher queue
  // the wrapper polls.
  __nextly_ipcServer?: { dispatcher: unknown; port: number } | null;
  // In-flight promise for IPC server bootstrap so concurrent calls to
  // ensureWrapperIpcServer wait for the same attempt rather than racing.
  __nextly_ipcServerPromise?: Promise<void> | null;
  // Task 11: latest pending schema change from the wrapper, surfaced to
  // the admin UI via /api/admin-meta/schema-pending so PendingSchemaBanner
  // knows when to show.
  __nextly_pendingSchemaChange?: {
    slug: string;
    classification: string;
    diff: unknown;
    ddlPreview?: string[];
    rowCounts?: Record<string, number>;
    receivedAt: string;
  } | null;
};

// Task 11: binds the IPC server used by the `nextly dev` wrapper. Idempotent
// and triggered from multiple init entry points (getNextly() and the module
// scope bootstrap below) because auth/admin handlers can call registerServices
// without going through getNextly and we need the IPC server up either way.
// No-op when NEXTLY_IPC_PORT/NEXTLY_IPC_TOKEN are unset (plain `next dev`).
export async function ensureWrapperIpcServer(): Promise<void> {
  if (globalForInit.__nextly_ipcServer) return;
  if (globalForInit.__nextly_ipcServerPromise)
    return globalForInit.__nextly_ipcServerPromise;

  const ipcPortRaw = process.env.NEXTLY_IPC_PORT;
  const ipcToken = process.env.NEXTLY_IPC_TOKEN;
  if (!ipcPortRaw || !ipcToken) return;
  const ipcPort = Number.parseInt(ipcPortRaw, 10);
  if (!Number.isFinite(ipcPort) || ipcPort <= 0) return;

  globalForInit.__nextly_ipcServerPromise = (async () => {
    try {
      // Lazy-import so users not running under the wrapper do not pay the
      // cost of loading the http server module into the dev bundle.
      const { startIpcServer } = await import("./cli/wrapper/ipc-server");
      const handle = await startIpcServer({
        port: ipcPort,
        token: ipcToken,
        onPending: payload => {
          globalForInit.__nextly_pendingSchemaChange = {
            slug: payload.slug,
            classification: payload.classification,
            diff: payload.diff,
            ddlPreview: payload.ddlPreview,
            rowCounts: payload.rowCounts,
            receivedAt: new Date().toISOString(),
          };
        },
        onApplied: () => {
          globalForInit.__nextly_pendingSchemaChange = null;
          bumpSchemaVersion();
        },
      });
      globalForInit.__nextly_ipcServer = {
        dispatcher: handle.dispatcher,
        port: handle.port,
      };
      console.log(
        `[Nextly] IPC server bound at 127.0.0.1:${handle.port} (wrapper mode)`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // EADDRINUSE with our own port means a previous module instance in
      // this same Node process already bound the server (Next/Turbopack
      // can re-execute our module on HMR while globalThis state from the
      // earlier run persists). Swallow silently rather than log a scary
      // warning; the server is up and the admin UI can reach it.
      if (msg.includes("EADDRINUSE")) {
        // Mark as bound so subsequent calls in this module instance skip
        // the attempt entirely. dispatcher is null here because we lost
        // the handle, but the admin dispatcher does not go through it
        // (it uses globalThis.__nextly_ipcServer?.dispatcher only for
        // UI-first apply enqueue which SHOULD still have the original
        // dispatcher set by whichever module actually won the bind).
        if (!globalForInit.__nextly_ipcServer) {
          globalForInit.__nextly_ipcServer = {
            dispatcher: null,
            port: ipcPort,
          };
        }
      } else {
        console.warn(
          `[Nextly] Could not start IPC server on port ${ipcPort}: ${msg}`
        );
      }
    } finally {
      globalForInit.__nextly_ipcServerPromise = null;
    }
  })();

  return globalForInit.__nextly_ipcServerPromise;
}

// Start the IPC server eagerly at module load when env vars are set. This
// covers the common case where Nextly is imported but getNextly() is not
// yet called - the wrapper can still reach the IPC endpoints.
if (process.env.NEXTLY_IPC_PORT && process.env.NEXTLY_IPC_TOKEN) {
  void ensureWrapperIpcServer();
}

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

        // IPC server startup moved OUT of this block and into
        // ensureWrapperIpcServer() below so it runs independently of
        // service registration. Other code paths (auth handler, etc.)
        // call registerServices() without going through getNextly(),
        // which used to mean the IPC server never bound.
      }

      // Run the IPC server bootstrap every time getNextly resolves. It
      // is idempotent and binds at most once per process.
      await ensureWrapperIpcServer();

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
