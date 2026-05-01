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
import { isServicesRegistered, registerServices, getService } from "../di";
import type { NextlyServiceConfig } from "../di/register";
import { getImageProcessor } from "../storage/image-processor";

// Lazy-initialized shared dispatcher instance
// This ensures the DI container has been set up before creating the dispatcher
let _dispatcher: ServiceDispatcher | null = null;

// Module-level config store, populated by `setHandlerConfig()`.
// This allows `createDynamicHandlers({ config })` to pass the user's
// nextly.config so that plugins and collections are registered on first request.
let _storedConfig: SanitizedNextlyConfig | null = null;

/**
 * Store the nextly config for use during service initialization.
 * Called by `createDynamicHandlers({ config })` in routeHandler.ts.
 */
export function setHandlerConfig(config: SanitizedNextlyConfig): void {
  _storedConfig = config;
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
async function ensureServicesInitialized(): Promise<void> {
  if (!isServicesRegistered()) {
    const nextlyConfig = _storedConfig;

    // Build service config from stored nextly.config.ts
    // IMPORTANT: Do NOT call getMediaStorage() here. The storage plugins from
    // config need to be registered first via registerServices(), which calls
    // initializeMediaStorage() with the correct plugins. Calling getMediaStorage()
    // before that creates a singleton with zero plugins (local fallback only).
    const serviceConfig: Record<string, unknown> = {
      imageProcessor: getImageProcessor(),
    };

    if (nextlyConfig) {
      // Pass through config properties that registerServices() understands
      if (nextlyConfig.plugins) serviceConfig.plugins = nextlyConfig.plugins;
      if (nextlyConfig.collections)
        serviceConfig.collections = nextlyConfig.collections;
      if (nextlyConfig.storage)
        serviceConfig.storagePlugins = nextlyConfig.storage;
      if (nextlyConfig.email) serviceConfig.email = nextlyConfig.email;
      if (nextlyConfig.users) serviceConfig.users = nextlyConfig.users;
      if (nextlyConfig.db) {
        const dbConfig = nextlyConfig.db as Record<string, unknown>;
        if (dbConfig.schemasDir) serviceConfig.schemasDir = dbConfig.schemasDir;
        if (dbConfig.migrationsDir)
          serviceConfig.migrationsDir = dbConfig.migrationsDir;
      }
    }

    await registerServices(serviceConfig as unknown as NextlyServiceConfig);

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
    // Without this, permissions like "manage-api-keys" won't exist and
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
   
  const deps = buildAuthRouterDeps(getService as (name: string) => any);
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
