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
import { resolveCollectionTableName } from "./domains/schema/utils/resolve-table-name";
import { NextlyError } from "./errors/nextly-error";
import {
  buildServiceConfig,
  type GetNextlyOptions,
} from "./init/build-service-config";
import { runBootTimeApplyIfDev } from "./init/boot-apply";
import { runDriftCheck } from "./init/drift-check";
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
 * Cached: subsequent calls return the same instance. The cache survives
 * Next.js HMR via `globalThis`.
 *
 * `config` is REQUIRED on every call (Task 24 phase 2). The cache check
 * happens after validation, so even cached lookups must pass config —
 * this matches Payload's `getPayload({ config })` contract and keeps
 * the call site self-documenting. Internal handlers that just need the
 * cached singleton (post-init) should use `getCachedNextly()` instead.
 *
 * @example
 * ```typescript
 * // Recommended — using the @nextly-config path alias
 * import { getNextly } from '@revnixhq/nextly';
 * import config from '@nextly-config';
 *
 * export async function GET() {
 *   const nextly = await getNextly({ config });
 *   const posts = await nextly.find({ collection: 'posts' });
 *   return Response.json(posts);
 * }
 * ```
 */
export async function getNextly(options: GetNextlyOptions): Promise<Nextly> {
  // Plan B contract: config is required on every call. We surface this
  // through NextlyError so it flows through the unified error system
  // (Task 21) and presents a stable code (`CONFIGURATION_ERROR`) plus
  // structured log context for operators. The publicMessage is kept
  // generic per spec §13.8; the precise call-site fix lives in the
  // logMessage so it shows up in the dev console without leaking to
  // wire responses if this surfaces inside withErrorHandler.
  if (!options?.config) {
    throw new NextlyError({
      code: "CONFIGURATION_ERROR",
      statusCode: 500,
      publicMessage: "Server configuration error.",
      logMessage:
        "getNextly() requires a `config` parameter. Import your config " +
        "and pass it: `getNextly({ config })`. If you are inside a " +
        "Nextly internal handler that just needs the cached singleton, " +
        "use `getCachedNextly()` instead.",
    });
  }
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

        // F8 PR 6: drift check. First-run static-table setup already
        // ran inside registerServices (see first-run.ts). This path
        // only logs a single warning when config has drifted from
        // the live schema — it does NOT auto-apply (real apply goes
        // through HMR or `nextly db:sync` which both have a TTY).
        // The drift check itself is failure-safe; we don't wrap a
        // try/catch around getService("config") so a real DI bug
        // crashes loudly instead of being masked.
        const config = getService("config");
        const driftLogger = {
          debug: (msg: string) => console.debug(msg),
          info: (msg: string) => console.log(msg),
          warn: (msg: string) => console.warn(msg),
          error: (msg: string) => console.error(msg),
        };
        const collections = (config.collections ?? []).map(c => ({
          slug: c.slug,
          tableName: resolveCollectionTableName(c.slug, c.dbName),
          fields: c.fields ?? [],
        }));
        await runDriftCheck({
          adapter,
          collections,
          logger: driftLogger,
        });

        // Boot-time auto-apply for code-first schema changes (dev only).
        // Shared with `route-handler/auth-handler.ts:ensureServicesInitialized`
        // so the same behavior applies whether the first request hits
        // the direct API or the route-handler dispatcher path.
        await runBootTimeApplyIfDev({ caller: "init" });

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
 * Return the already-initialised Nextly instance from the singleton cache.
 *
 * Use this inside Nextly's own internal API handlers (anywhere under
 * `packages/nextly/src/api/*`) where the user-provided config is not in
 * scope. Throws a clear error if the singleton has not been initialised
 * yet — the typical fix is to ensure the project ships an
 * `instrumentation.ts` that calls `createRegister(config)` so init runs
 * once per worker before the first request.
 *
 * Do NOT use this in user code. User code should always call
 * `getNextly({ config })` directly.
 */
export async function getCachedNextly(): Promise<Nextly> {
  if (globalForInit.__nextly_cachedInstance) {
    return globalForInit.__nextly_cachedInstance;
  }
  // Concurrent first-call: another caller is mid-init; share their Promise.
  if (globalForInit.__nextly_initPromise) {
    return globalForInit.__nextly_initPromise;
  }

  // Fallback path: services may have been registered via
  // `registerServices()` directly (e.g. from `createDynamicHandlers`'s
  // `ensureServicesInitialized` in routeHandler.ts) without ever
  // calling the public `getNextly({ config })` factory. In that case
  // the DI container has services but the public Nextly singleton was
  // never built. Build it now from whatever config is reachable so
  // internal API handlers that only need `getService(...)` keep
  // working. This means BOTH paths converge on the same cached
  // Nextly instance, so a later `getNextly({ config })` call from
  // user code returns the same singleton.
  if (isServicesRegistered()) {
    const directAPI = getDirectAPI();
    const instance: Nextly = {
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
      login: directAPI.login.bind(directAPI),
      logout: directAPI.logout.bind(directAPI),
      me: directAPI.me.bind(directAPI),
      updateMe: directAPI.updateMe.bind(directAPI),
      register: directAPI.register.bind(directAPI),
      changePassword: directAPI.changePassword.bind(directAPI),
      forgotPassword: directAPI.forgotPassword.bind(directAPI),
      resetPassword: directAPI.resetPassword.bind(directAPI),
      verifyEmail: directAPI.verifyEmail.bind(directAPI),
      users: directAPI.users,
      media: directAPI.media,
      forms: directAPI.forms,
      emailProviders: directAPI.emailProviders,
      emailTemplates: directAPI.emailTemplates,
      userFields: directAPI.userFields,
      email: directAPI.email,
      roles: directAPI.roles,
      permissions: directAPI.permissions,
      access: directAPI.access,
      collections: getService("collectionService"),
      userService: getService("userService"),
      mediaService: getService("mediaService"),
      storage: getService("mediaStorage"),
      adapter: getService("adapter"),
      shutdown: async () => {
        await shutdownServices();
        globalForInit.__nextly_cachedInstance = null;
      },
    };
    globalForInit.__nextly_cachedInstance = instance;
    return instance;
  }

  throw new NextlyError({
    code: "CONFIGURATION_ERROR",
    statusCode: 500,
    publicMessage: "Server configuration error.",
    logMessage:
      "getCachedNextly() called before initialization. Ensure " +
      "`getNextly({ config })` (or `createRegister(config)` from " +
      "instrumentation.ts) has run at least once before any internal " +
      "handler executes. See https://nextlyhq.com/docs/getting-started.",
  });
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
