/**
 * Auth Handler Module
 *
 * Handles authentication-specific API endpoints.
 * Extracted from routeHandler.ts for better separation of concerns.
 */

import { ServiceDispatcher } from "@nextly/services/dispatcher";

import { buildAuthRouterDeps } from "../auth/handlers/deps-bridge";
import { routeAuthRequest } from "../auth/handlers/router";
import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import {
  isServicesRegistered,
  registerServices,
  getService,
  shutdownServices,
} from "../di";
import type { NextlyServiceConfig } from "../di/register";
import { buildServiceConfig } from "../init/build-service-config";
import type { PluginDefinition } from "../plugins/plugin-context";
import { ensureHmrListener } from "../runtime/hmr-listener";
import { getImageProcessor } from "../storage/image-processor";

// Lazy-initialized shared dispatcher instance
// This ensures the DI container has been set up before creating the dispatcher
let _dispatcher: ServiceDispatcher | null = null;

// Module-level config store, populated by `setHandlerConfig()`.
// This allows `createDynamicHandlers({ config })` to pass the user's
// nextly.config so that plugins and collections are registered on first request.
let _storedConfig: SanitizedNextlyConfig | null = null;

/**
 * The plugin list as boot produced it, or null before any boot has run.
 *
 * Held separately from `_storedConfig` rather than folded into it, because the
 * two have independent lifecycles: the route config is re-stored every time the
 * route module is evaluated, while boot transforms the plugin list once per
 * process. Writing the transformed list INTO the stored config would leave
 * whichever write happened to land last as the winner — and both orders occur.
 * A boot through `getNextly()` or instrumentation runs before the route module
 * is imported, and route-module HMR re-stores the raw config without booting
 * again. Either way the raw list would silently replace the booted one.
 */
let _bootPlugins: PluginDefinition[] | null = null;

/**
 * Fold the booted plugin list into the stored config.
 *
 * The single place the two inputs meet, called from both writers so the result
 * cannot depend on the order they arrive in. Only the plugins are taken from
 * boot: the transformed config carries no `typescript`, `db` or `storage`, so
 * adopting it wholesale would silently drop three fields this store holds.
 */
function foldBootPluginsIntoStore(): void {
  if (!_storedConfig || !_bootPlugins) return;
  _storedConfig = { ..._storedConfig, plugins: _bootPlugins };
}

/**
 * Store the nextly config for use during service initialization.
 * Called by `createDynamicHandlers({ config })` in routeHandler.ts.
 */
export function setHandlerConfig(config: SanitizedNextlyConfig): void {
  _storedConfig = config;
  foldBootPluginsIntoStore();
}

/**
 * Record the plugin list boot produced, and re-point the store at it.
 *
 * The store is populated when the route module is imported, which is the
 * earliest the config exists and is before any `setup` transformer has run.
 * Boot then transforms the list — a transformer may add, remove, or flip the
 * `enabled` flag on a plugin — and the public admin-meta endpoint reads this
 * store WITHOUT initializing services, so without this it describes plugins as
 * their author declared them rather than as they actually booted.
 *
 * An empty list is a meaningful value, not an absent one: it is what a
 * transformer that removes every plugin produces, and the store must then stop
 * advertising the plugins the author declared.
 */
export function setHandlerPlugins(plugins: PluginDefinition[]): void {
  _bootPlugins = plugins;
  foldBootPluginsIntoStore();
}

/**
 * Retrieve the stored nextly config.
 * Used by the admin-meta endpoint to read branding config without going
 * through the service dispatcher.
 */
export function getHandlerConfig(): SanitizedNextlyConfig | null {
  return _storedConfig;
}

/**
 * The `localization` block, as it stood in the ROUTE config when services
 * were last known to match it. Null until the first observation.
 */
let _registeredLocalization: string | null = null;

/** The comparable form of a config's localization block. */
function localizationKey(config: SanitizedNextlyConfig | null): string {
  return JSON.stringify(config?.localization ?? null);
}

/**
 * Whether the stored config's `localization` block has moved since services
 * were registered from it.
 *
 * Compared against the route config's OWN previous value rather than the
 * container's: what `registerServices` stores is the plugin-transformed
 * config, so an app whose plugin supplies or normalizes `localization` would
 * show a difference that re-registering can never remove — every request
 * would tear the services down and rebuild the adapter, forever.
 *
 * Callers reach this only once services are already registered, and this
 * module records a baseline whenever IT registers them — so no recorded value
 * means some other path did (an `instrumentation.ts` boot). Those services
 * captured whatever `localization` was current when that path ran, which is
 * not observable from here: the config may have been edited before this route
 * module ever saw a request. Unverifiable is treated as changed, costing one
 * rebuild on the first request of such a process. It cannot loop, because the
 * rebuild records this same route config as the baseline and every later
 * request then compares equal.
 */
function localizationBlockChanged(stored: SanitizedNextlyConfig): boolean {
  const current = localizationKey(stored);
  if (_registeredLocalization === null) return true;
  return _registeredLocalization !== current;
}

// Test seams: the staleness decision is the behavioral contract of the
// dev-only re-registration in ensureServicesInitialized; exporting these
// under verbose names keeps the public surface honest while letting unit
// tests pin it. The decision function deliberately does not write the
// baseline — only a registration does — so pinning any behavior past the
// first observation needs the recording step too.
export const _localizationBlockChangedForTest = localizationBlockChanged;

export function _recordRegisteredLocalizationForTest(
  config: SanitizedNextlyConfig | null
): void {
  _registeredLocalization = localizationKey(config);
}

/**
 * The service configuration a cold boot triggered by a request registers with.
 *
 * Derived from `buildServiceConfig`, the same builder the instrumentation boot
 * uses, rather than from a second list of config blocks maintained beside it.
 * The two paths must register the same shape, and a hand-copied list cannot be
 * relied on to: a block added to one and forgotten in the other resolves,
 * defaults, and then does nothing, with no error anywhere to say so. That has
 * happened repeatedly — `admin.devAutoLogin` vanished, app-defined Singles were
 * never registered, `localization` left every localized read silently writing
 * to the main table. Asking the builder makes the question have one answer.
 *
 * `db` is the one block still read here, because the two paths genuinely
 * DISAGREE about it rather than one having forgotten it: absent `schemasDir`,
 * `register-collections.ts` falls back to `<basePath>/src/db/schemas/dynamic`,
 * while `config.db.schemasDir` defaults to `./src/db/schemas/collections`. So
 * forwarding it is a behaviour difference between boot paths, not an omission,
 * and it is not this function's to settle.
 */
export function requestPathServiceConfig(
  nextlyConfig: SanitizedNextlyConfig | null
): NextlyServiceConfig {
  // Never `getMediaStorage()` here: storage plugins are registered by
  // `registerServices()` -> `initializeMediaStorage()`, so touching the
  // singleton first builds one with no plugins and a local-only fallback.
  const imageProcessor = getImageProcessor();
  if (!nextlyConfig) return { imageProcessor };

  const serviceConfig = buildServiceConfig({
    config: nextlyConfig,
    imageProcessor,
  });

  const dbConfig = nextlyConfig.db;
  if (dbConfig?.schemasDir) serviceConfig.schemasDir = dbConfig.schemasDir;
  if (dbConfig?.migrationsDir)
    serviceConfig.migrationsDir = dbConfig.migrationsDir;

  return serviceConfig;
}

/**
 * Ensure services are initialized, auto-initializing if needed.
 * This is critical for Singles and other services that depend on the DI container.
 *
 * If a nextly config was stored via `setHandlerConfig()`, its plugins,
 * collections, email, and user settings are forwarded to `registerServices()`.
 * This enables plugin-provided collections (e.g., form-builder) to be
 * registered automatically.
 *
 * Storage is optional - if not configured, services will be initialized without it.
 * This allows collections/singles endpoints to work even when no storage plugin is set up.
 */
/**
 * Exported so the direct-dispatch entry points in `routeHandler.ts` can boot DI
 * before running. Those handlers resolve services through `getCachedNextly()`,
 * which throws rather than initialising, and they return before the
 * `getDispatcher()` call that would otherwise have done it. Calling this
 * consumes no request body, so a handler that parses its own body still can.
 */
export async function ensureServicesInitialized(): Promise<void> {
  // Single-flight: concurrent requests share one recovery+registration pass
  // instead of interleaving. Without this, two dev requests could both
  // detect a stale localization block and overlap shutdownServices() — the
  // later teardown destroying the services the earlier request had just
  // re-registered — and the same latch keeps a cold boot from being
  // double-registered by simultaneous first requests.
  while (_initInFlight) {
    await _initInFlight;
  }
  const run = initializeServicesOnce().finally(() => {
    if (_initInFlight === run) _initInFlight = null;
  });
  _initInFlight = run;
  await run;
}

// The in-flight recovery/registration pass concurrent callers await.
let _initInFlight: Promise<void> | null = null;

async function initializeServicesOnce(): Promise<void> {
  // Dev-only staleness recovery: services register ONCE per process, but
  // editing nextly.config.ts re-evaluates the route module, which stores the
  // NEW config here without re-registering anything. For most blocks that is
  // fine (schema changes flow through the HMR reconcile), but `localization`
  // is captured by the data services at construction — a stale value makes
  // every localized read/write silently no-op to the main table (writes then
  // fail with "no column named X" on a split table). When the stored block
  // differs from the registered one, tear services down so the block below
  // re-registers them with the current config. Gated to development: config
  // modules never hot-change in production.
  if (
    process.env.NODE_ENV === "development" &&
    isServicesRegistered() &&
    _storedConfig &&
    localizationBlockChanged(_storedConfig)
  ) {
    console.log(
      "[Nextly] `localization` config changed — re-registering services to apply it..."
    );
    await shutdownServices();
    // The cached dispatcher wraps a ServiceContainer built on the adapter
    // that shutdown just disconnected, and its ensureInitialized() keeps an
    // existing adapter. Drop it so the next getDispatcherInstance() builds
    // one against the freshly registered services.
    _dispatcher = null;
  }

  if (!isServicesRegistered()) {
    const nextlyConfig = _storedConfig;

    // Build service config from stored nextly.config.ts
    // IMPORTANT: Do NOT call getMediaStorage() here. The storage plugins from
    // config need to be registered first via registerServices(), which calls
    // initializeMediaStorage() with the correct plugins. Calling getMediaStorage()
    // before that creates a singleton with zero plugins (local fallback only).
    const serviceConfig = requestPathServiceConfig(nextlyConfig);

    // Warn (dev only) when an app boots through the request path instead
    // of via Next.js's instrumentation.ts. The request-path boot still
    // works, but with multiple Next.js workers it multiplies cold-start
    // introspection + permission seeding by worker count and is a
    // significant amplifier of Neon connection pressure. The fix is one
    // line in the user's `instrumentation.ts`. See:
    // https://nextly.dev/docs/getting-started/instrumentation
    //
    // Gate on `=== "development"` (not `!== "production"`) to match
    // boot-apply.ts and to avoid polluting `test` runs and staging logs
    // where the audience can't take action on the warning.
    if (
      process.env.NODE_ENV === "development" &&
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING !== "1"
    ) {
      console.warn(
        "[nextly] Cold-boot triggered by an incoming request — no " +
          "instrumentation.ts detected. Each Next.js worker will now " +
          "independently run schema introspection and permission seeding " +
          "against your database, multiplying connection load. Add an " +
          "`instrumentation.ts` at your project root (see " +
          "https://nextly.dev/docs/getting-started/instrumentation) to " +
          "fold this into a single worker-warmup. Suppress with " +
          "NEXTLY_DISABLE_INSTRUMENTATION_WARNING=1."
      );
    }

    await registerServices(serviceConfig);
    // Services now match the block this config was registered from, so that
    // is the value a later request compares against.
    _registeredLocalization = localizationKey(nextlyConfig);

    // Seed built-in email templates (password-reset, welcome, etc.)
    // This mirrors init.ts runPostInitTasks() so external apps using
    // createDynamicHandlers() get templates auto-seeded on first request.
    try {
      const emailTemplateService = getService("emailTemplateService");
      await emailTemplateService.ensureBuiltInTemplates();
    } catch {
      // Silently skip — email_templates table may not exist yet
    }

    // Seed system + collection + single permissions (idempotent).
    // This mirrors init.ts runPostInitTasks() so external apps using
    // createDynamicHandlers() get permissions auto-seeded on first request.
    // Without this, permissions like "update-api-keys" won't exist and
    // the admin UI will block access to protected settings tabs.
    try {
      const permissionSeedService = getService("permissionSeedService");
      const systemResult = await permissionSeedService.seedSystemPermissions();
      const collectionResult =
        await permissionSeedService.seedAllCollectionPermissions();
      const singleResult =
        await permissionSeedService.seedAllSinglePermissions();

      const allNewIds = [
        ...systemResult.newPermissionIds,
        ...collectionResult.newPermissionIds,
        ...singleResult.newPermissionIds,
      ];

      if (allNewIds.length > 0) {
        await permissionSeedService.assignNewPermissionsToSuperAdmin(allNewIds);
      }
    } catch {
      // Silently skip — permissions table may not exist yet (migrations not run),
      // or permissionSeedService may not be registered
    }

    // Sync user extension fields and ensure user_ext table exists
    // This mirrors the init.ts flow so route handler requests work
    // with UI-created custom user fields (e.g., "designation")
    try {
      const userExtSchemaService = getService("userExtSchemaService");
      await userExtSchemaService.loadMergedFields();

      if (userExtSchemaService.hasMergedFields()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter shape varies by driver
        const adapter = getService("adapter") as any;
        const drizzleDb = adapter.getDrizzle();
        await userExtSchemaService.ensureUserExtSchema(drizzleDb);
      }
    } catch (err: unknown) {
      console.error(
        "[Auth Handler] Error during user_ext schema setup:",
        err instanceof Error ? err.message : String(err)
      );
    }

    if (nextlyConfig) {
      const pluginCount = Array.isArray(nextlyConfig.plugins)
        ? nextlyConfig.plugins.length
        : 0;
      const collectionCount = Array.isArray(nextlyConfig.collections)
        ? nextlyConfig.collections.length
        : 0;
      const storageCount = Array.isArray(nextlyConfig.storage)
        ? nextlyConfig.storage.length
        : 0;
      console.log(
        `[Auth Handler] Services auto-initialized with config (${pluginCount} plugin(s), ${collectionCount} collection(s), ${storageCount} storage adapter(s))`
      );
    } else {
      console.log("[Auth Handler] Services auto-initialized with defaults");
    }

    // Boot-time auto-apply for code-first schema changes (dev only).
    // The route-handler path (here) and the direct-API path
    // (`init.ts:getNextly`) both must call this so dev restart correctly
    // applies code-first field renames/drops to the actual table columns,
    // not just to `dynamic_collections.fields` JSON. See
    // `init/boot-apply.ts` for full rationale.
    const { runBootTimeApplyIfDev } = await import("../init/boot-apply");
    await runBootTimeApplyIfDev({ caller: "auth-handler" });

    // Production sibling: apply committed migrations on boot when opted in
    // (db.runMigrationsOnBoot). No-op in dev. Failure-safe.
    const handlerConfig = getHandlerConfig();
    if (handlerConfig) {
      const { runProdMigrationsIfEnabled } = await import(
        "../init/prod-migrations"
      );
      await runProdMigrationsIfEnabled({
        config: handlerConfig,
        adapter: getService("adapter"),
        logger: {
          info: m => console.log(m),
          warn: m => console.warn(m),
          error: m => console.error(m),
          debug: m => console.debug(m),
        },
      });
    }

    // Open the HMR listener so live edits to nextly.config.ts during a
    // running dev session reach reloadNextlyConfig(). Without this, only
    // the boot-time apply above runs and in-session config edits silently
    // no-op. Mirrors the symmetric call in init.ts:getNextly so the
    // route-handler path and the direct-API path both wire HMR the same
    // way. ensureHmrListener is idempotent and gated on NODE_ENV / the
    // NEXTLY_DISABLE_HMR escape hatch.
    ensureHmrListener();
  }
}

async function getDispatcherInstance(): Promise<ServiceDispatcher> {
  // Ensure DI container is initialized before creating dispatcher
  await ensureServicesInitialized();

  if (!_dispatcher) {
    _dispatcher = new ServiceDispatcher();
  }
  return _dispatcher;
}

/**
 * Handle authentication-specific API requests.
 * Routes all auth endpoints through the custom auth router (replaces Auth.js).
 *
 * Supported endpoints:
 * - GET  /api/auth/setup-status - Check if initial setup is complete
 * - GET  /api/auth/session - Get current session (stateless JWT verification)
 * - GET  /api/auth/csrf - Generate CSRF token
 * - POST /api/auth/login - Email + password login
 * - POST /api/auth/logout - Session revocation
 * - POST /api/auth/refresh - Token rotation
 * - POST /api/auth/setup - Create first admin account (auto-login)
 * - POST /api/auth/register - User registration
 * - PATCH /api/auth/change-password - Change password (revokes all sessions)
 * - POST /api/auth/forgot-password - Request password reset
 * - POST /api/auth/reset-password - Reset password with token
 * - POST /api/auth/verify-email - Verify email with token
 * - POST /api/auth/verify-email/resend - Resend verification email
 */
export async function handleAuthRequest(
  req: Request,
  params: string[],
  _httpMethod: string
): Promise<Response> {
  await ensureServicesInitialized();

  // Build the auth path from params (e.g., ["auth", "login"] -> "login")
  // Handle nested paths like ["auth", "verify-email", "resend"] -> "verify-email/resend"
  const authPath = params.slice(1).join("/");

  // Build deps from DI container and route to the appropriate handler

  const deps = buildAuthRouterDeps(getService as (name: string) => unknown);
  const response = await routeAuthRequest(req, authPath, deps);

  if (response) {
    return response;
  }

  // No matching auth route found
  return new Response(
    JSON.stringify({
      error: { code: "NOT_FOUND", message: "Auth endpoint not found" },
    }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Get the shared dispatcher instance
 * Used by the main route handler for service requests
 */
export async function getDispatcher(): Promise<ServiceDispatcher> {
  return getDispatcherInstance();
}
