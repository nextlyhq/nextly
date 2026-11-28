/**
 * Auth Handler Module
 *
 * Handles authentication-specific API endpoints.
 * Extracted from routeHandler.ts for better separation of concerns.
 */

import { isNextBuildPhase } from "@nextlyhq/adapter-drizzle/build-phase";

import { buildAuthRouterDeps } from "../auth/handlers/deps-bridge";
import { routeAuthRequest } from "../auth/handlers/router";
import { setSessionStandingBoot } from "../auth/session/session-standing";
import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import { isServicesRegistered, getService } from "../di";
// Only the type: the registry itself is loaded by `initializeServicesOnce`,
// the one place here that registers or shuts the services down.
import type {
  NextlyServiceConfig,
  RegisterServicesOptions,
} from "../di/register";
import {
  localizationKey,
  recordRegisteredLocalization,
  registeredLocalization,
} from "../di/registered-localization";
import { awaitBootMigrations } from "../init/boot-migrations-gate";
import {
  buildServiceConfig,
  type GetNextlyOptions,
} from "../init/build-service-config";
import { isProductionStart } from "../init/production-start";
import {
  awaitBootSeeding,
  holdBootSeeding,
  seedPermissionsAndRolePresets,
} from "../init/seed-permissions";
import { awaitStartInFlight } from "../init/start-in-flight";
import { ensureHmrListener } from "../runtime/hmr-listener";
// Only the type: the class is loaded by `getDispatcherInstance`.
import type { ServiceDispatcher } from "../services/dispatcher";
import { consoleLogger } from "../shared/types";
import { getImageProcessor } from "../storage/image-processor";

import { storedRouteConfig } from "./handler-config";
import { servedSchemaVersion } from "./schema-version";

// Lazy-initialized shared dispatcher instance
// This ensures the DI container has been set up before creating the dispatcher
let _dispatcher: ServiceDispatcher | null = null;

// The config store lives in `./handler-config`, so its readers load it without
// this module; re-exported here for this module's callers.
export {
  bootedPlugins,
  getHandlerConfig,
  setBootedConfig,
  setHandlerConfig,
} from "./handler-config";

/**
 * Whether the stored config's `localization` block has moved since services
 * were registered from it.
 *
 * Compared against the block the registering boot was HANDED, recorded in
 * `di/registered-localization`, rather than the container's: what
 * `registerServices` stores is the plugin-transformed config, so an app whose
 * plugin supplies or normalizes `localization` would show a difference that
 * re-registering can never remove — every request would tear the services
 * down and rebuild the adapter, forever.
 *
 * Both boots record it: this module whenever IT registers the services, and
 * `getNextly`, which an app's server code, an `instrumentation.ts` and the
 * admin's component check call. A record from `getNextly` describes the
 * config those services were really built from, so a config edited before
 * this route module saw a request still reads as changed, and an unchanged
 * one does not cost a rebuild that would disconnect the adapter under other
 * requests. Only a registration that recorded nothing is unverifiable, and
 * that is treated as changed, costing one rebuild. It cannot loop, because the
 * rebuild records this same route config and every later request then
 * compares equal.
 */
function localizationBlockChanged(stored: SanitizedNextlyConfig): boolean {
  const registered = registeredLocalization();
  if (registered === undefined) return true;
  return registered !== localizationKey(stored);
}

/**
 * Whether this pass will tear the services down to register them again: in
 * development, when the stored config's `localization` block has moved. Read
 * by the pass itself and by the seeding hold taken before it, so the two cannot
 * disagree about whether the pass registers.
 */
function needsLocalizationReregistration(): boolean {
  const stored = storedRouteConfig();
  return (
    process.env.NODE_ENV === "development" &&
    isServicesRegistered() &&
    stored !== null &&
    localizationBlockChanged(stored)
  );
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
  recordRegisteredLocalization(config);
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
  if (!nextlyConfig) return { imageProcessor: getImageProcessor() };
  return buildServiceConfig(requestPathStartOptions(nextlyConfig));
}

/**
 * The options a start a request begins hands `getNextly`, from which
 * {@link requestPathServiceConfig} derives the services' configuration: the
 * route's config, with the `db` directories forwarded as the request path
 * always has.
 */
function requestPathStartOptions(
  nextlyConfig: SanitizedNextlyConfig
): GetNextlyOptions {
  // Never `getMediaStorage()` here: storage plugins are registered by
  // `registerServices()` -> `initializeMediaStorage()`, so touching the
  // singleton first builds one with no plugins and a local-only fallback.
  const options: GetNextlyOptions = {
    config: nextlyConfig,
    imageProcessor: getImageProcessor(),
  };
  const dbConfig = nextlyConfig.db;
  if (dbConfig?.schemasDir) options.schemasDir = dbConfig.schemasDir;
  if (dbConfig?.migrationsDir) options.migrationsDir = dbConfig.migrationsDir;
  return options;
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
  // A start another entry point began (the start-up hook, which no longer
  // waits for it, or code calling the Direct API) is the start: this request
  // waits for it rather than registering the services, seeding and running
  // the rest of a start a second time beside it.
  await awaitStartInFlight();
  // Single-flight: concurrent requests share one recovery+registration pass
  // instead of interleaving. Without this, two dev requests could both
  // detect a stale localization block and overlap shutdownServices() — the
  // later teardown destroying the services the earlier request had just
  // re-registered — and the same latch keeps a cold boot from being
  // double-registered by simultaneous first requests.
  while (_initInFlight) {
    await _initInFlight;
  }
  // Taken before a pass that tears the services down to register them again
  // after a development config change, from before the teardown, which is
  // when the instrumentation boot would start finding them unregistered and
  // then registered: it waits on this hold until the pass has seeded. Released
  // before this boot waits on the gate itself, so it never waits on its own
  // hold. A pass that registers cold takes its hold where it registers.
  const releaseSeeding = needsLocalizationReregistration()
    ? holdBootSeeding()
    : undefined;
  const run = initializeServicesOnce().finally(() => {
    if (_initInFlight === run) _initInFlight = null;
  });
  _initInFlight = run;
  try {
    await run;
  } finally {
    releaseSeeding?.();
  }

  // The pass above seeds only when it registered the services itself. When the
  // instrumentation boot registered them, it may still be seeding, and this
  // request must not be judged against roles it is still writing.
  await awaitBootSeeding();

  // After registration, because this is the request path's own gate: a boot on
  // ANOTHER surface may still be waiting on the migrate lock, and this one must
  // not start dispatching until that settles. Resolves immediately when no boot
  // opened the gate.
  await awaitBootMigrations();

  // Last, once this process serves: its definitions follow the stored schema
  // version, so a schema change another server copy (or a migration) made is
  // loaded here before the request is served. Reads nothing while the last
  // read is fresh (`route-handler/schema-version`).
  await servedSchemaVersion();
}

// The in-flight recovery/registration pass concurrent callers await.
let _initInFlight: Promise<void> | null = null;

// A session read needs the database to say whether the account may still use
// its token, and some routes authenticate before anything has booted. The
// check starts the services through this boot, and only for a token whose
// signature has already verified, so a request without one still boots
// nothing (`auth/session/session-standing`).
setSessionStandingBoot(ensureServicesInitialized);

async function initializeServicesOnce(): Promise<void> {
  // The registry imports every service registration, so it is loaded on the
  // first boot, not by importing the route handler. Loaded first, so the
  // registered check and the registration below run with nothing awaited
  // between them, as they did with a static import.
  const { registerServices, shutdownServices } = await import("../di/register");

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
  const reregistering = needsLocalizationReregistration();
  if (reregistering) {
    consoleLogger.info(
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
    const nextlyConfig = storedRouteConfig();

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
      consoleLogger.warn(
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

    // A cold start begun by this request is `getNextly`'s start, the one the
    // start-up hook and the Direct API run: the same steps, the same
    // statements, and one start whichever of them begins it, since a start any
    // of them begins later joins this one. Loaded here, as the registry is,
    // so importing the route handler does not load the start.
    if (nextlyConfig && !reregistering) {
      const { getNextly } = await import("../init");
      await getNextly(requestPathStartOptions(nextlyConfig));
      // Registered once the start has run. Checked rather than assumed, so a
      // start that answered without registering anything is met by this pass
      // registering them, below, as it always has.
      if (isServicesRegistered()) {
        logRequestPathStart(nextlyConfig);
        return;
      }
    }

    // Without a config, or registering again after a development change to
    // `localization`, this pass registers the services itself: `getNextly`
    // needs a config, and keeps the instance whose services were just shut
    // down, so it would not register them again. Held from before the
    // services read as registered until this pass has seeded, so a boot that
    // finds them registered waits for the seeding (`awaitBootSeeding`). Taken
    // here rather than around the whole pass: a pass that runs `getNextly`'s
    // start may join one a Direct API caller began, which can itself be
    // waiting on the seeding gate, and a hold around it would never release.
    const releaseSeeding = holdBootSeeding();
    try {
      await registerFromThisRequest(registerServices, nextlyConfig);
    } finally {
      releaseSeeding();
    }
  }
}

/**
 * Register the services from this route's config, and run the start's other
 * steps the request path runs for a registration of its own.
 */
async function registerFromThisRequest(
  registerServices: (
    config: NextlyServiceConfig,
    options: RegisterServicesOptions
  ) => Promise<void>,
  nextlyConfig: SanitizedNextlyConfig | null
): Promise<void> {
  // Build service config from stored nextly.config.ts
  // IMPORTANT: Do NOT call getMediaStorage() here. The storage plugins from
  // config need to be registered first via registerServices(), which calls
  // initializeMediaStorage() with the correct plugins. Calling getMediaStorage()
  // before that creates a singleton with zero plugins (local fallback only).
  // A start, so in production it writes no bookkeeping (`isProductionStart`).
  await registerServices(requestPathServiceConfig(nextlyConfig), {
    start: true,
  });
  // Services now match the block this config was registered from, so that
  // is the value a later request compares against.
  recordRegisteredLocalization(nextlyConfig);

  // Seed built-in email templates (password-reset, welcome, etc.)
  // This mirrors init.ts runPostInitTasks() so external apps using
  // createDynamicHandlers() get templates auto-seeded on first request.
  // Not in `next build`, which writes nothing: the first start after it seeds.
  if (!isNextBuildPhase()) {
    try {
      const emailTemplateService = getService("emailTemplateService");
      await emailTemplateService.ensureBuiltInTemplates();
    } catch {
      // Silently skip — email_templates table may not exist yet
    }
  }

  // The same seeding the instrumentation boot performs, so an app that cold
  // boots only through `createDynamicHandlers` ends up with the same rows.
  // Shared rather than mirrored: this path used to seed system, collection
  // and single permissions and stop there, which left a plugin's declared
  // permission with no row and no super-admin grant on the one boot path
  // that never runs post-init tasks. The PRESET roles were the next thing to
  // be missing from it for the same reason, so the two are now one call.
  // A production start seeds nothing, as `getNextly`'s does not: the
  // permissions, roles and grants are `nextly migrate`'s to write.
  if (!isProductionStart()) await seedPermissionsAndRolePresets();

  // Sync user extension fields and ensure user_ext table exists
  // This mirrors the init.ts flow so route handler requests work
  // with UI-created custom user fields (e.g., "designation")
  try {
    const userExtSchemaService = getService("userExtSchemaService");
    await userExtSchemaService.loadMergedFields();

    // Loaded only, in production: the columns are `nextly migrate`'s to add,
    // as `provisionUserFieldsAtStart` leaves them on `getNextly`'s start.
    if (userExtSchemaService.hasMergedFields() && !isProductionStart()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter shape varies by driver
      const adapter = getService("adapter") as any;
      const drizzleDb = adapter.getDrizzle();
      await userExtSchemaService.ensureUserExtSchema(drizzleDb);
    }
  } catch (err: unknown) {
    consoleLogger.error("[Auth Handler] Error during user_ext schema setup", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  logRequestPathStart(nextlyConfig);

  // Boot-time auto-apply for code-first schema changes (dev only).
  // The route-handler path (here) and the direct-API path
  // (`init.ts:getNextly`) both must call this so dev restart correctly
  // applies code-first field renames/drops to the actual table columns,
  // not just to `dynamic_collections.fields` JSON. See
  // `init/boot-apply.ts` for full rationale.
  const { runBootTimeApplyIfDev } = await import("../init/boot-apply");
  await runBootTimeApplyIfDev({ caller: "auth-handler" });

  // No production migration call here. `registerServices` above already ran
  // them — before any plugin initialised, from the `db` block
  // `requestPathServiceConfig` forwards and the schema the boot actually runs
  // (transformed plugins, folded entities, deferred Builder extends). A
  // second run from this store would compile a narrower schema than the one
  // just applied, and the instrumentation boot (`getNextly`) makes no such
  // second call, so both boot paths apply migrations exactly once, the same
  // way.

  // Open the HMR listener so live edits to nextly.config.ts during a
  // running dev session reach reloadNextlyConfig(). Without this, only
  // the boot-time apply above runs and in-session config edits silently
  // no-op. Mirrors the symmetric call in init.ts:getNextly so the
  // route-handler path and the direct-API path both wire HMR the same
  // way. ensureHmrListener is idempotent and gated on NODE_ENV / the
  // NEXTLY_DISABLE_HMR escape hatch.
  ensureHmrListener();
}

/** Say that a request started the services, and with what. */
function logRequestPathStart(nextlyConfig: SanitizedNextlyConfig | null): void {
  if (!nextlyConfig) {
    consoleLogger.info(
      "[Auth Handler] Services auto-initialized with defaults"
    );
    return;
  }
  const pluginCount = Array.isArray(nextlyConfig.plugins)
    ? nextlyConfig.plugins.length
    : 0;
  const collectionCount = Array.isArray(nextlyConfig.collections)
    ? nextlyConfig.collections.length
    : 0;
  const storageCount = Array.isArray(nextlyConfig.storage)
    ? nextlyConfig.storage.length
    : 0;
  consoleLogger.info(
    `[Auth Handler] Services auto-initialized with config (${pluginCount} plugin(s), ${collectionCount} collection(s), ${storageCount} storage adapter(s))`
  );
}

async function getDispatcherInstance(): Promise<ServiceDispatcher> {
  // Ensure DI container is initialized before creating dispatcher
  await ensureServicesInitialized();

  // The dispatcher reaches the route handler and every REST handler, so it is
  // loaded when the first request needs one, not by importing this module.
  // Loaded before the check, so checking and creating it stay one step.
  const { ServiceDispatcher } = await import("../services/dispatcher");

  if (!_dispatcher) {
    _dispatcher = new ServiceDispatcher();
  }
  return _dispatcher;
}

/**
 * Drop the cached dispatcher, so the next request builds one on whatever
 * adapter is registered then.
 *
 * A server registers one adapter for its life and keeps one dispatcher on it,
 * and nothing in product code calls this. The test harness does: it boots one
 * instance after another in one process and disconnects each one's adapter on
 * teardown, and a dispatcher kept from an earlier instance would answer the
 * next instance's REST requests from that closed adapter.
 */
export function resetDispatcherForTests(): void {
  _dispatcher = null;
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
