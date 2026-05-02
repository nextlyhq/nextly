/**
 * Dynamic Route Handler
 *
 * Creates HTTP method handlers for Next.js API routes.
 * This module serves as the main orchestrator, delegating to:
 * - route-handler/route-parser.ts for REST route parsing
 * - route-handler/auth-handler.ts for auth-specific endpoints
 *
 * @example
 * ```typescript
 * // In your Next.js route handler (e.g., app/api/[[...params]]/route.ts)
 * import { createDynamicHandlers } from '@revnixhq/nextly';
 *
 * const handlers = createDynamicHandlers();
 * export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = handlers;
 * ```
 */

import {
  requireAuthentication,
  requirePermission,
  requireAnyPermission,
  requireCollectionAccess,
  createJsonErrorResponse,
  isErrorResponse,
  type AuthContext,
  type ErrorResponse,
} from "@nextly/auth/middleware";
import type { DispatchRequest } from "@nextly/services/dispatcher";

import {
  listApiKeys,
  getApiKeyById,
  createApiKey,
  updateApiKey,
  revokeApiKey,
} from "./api/api-keys";
import {
  getDashboardStats,
  getDashboardRecentEntries,
  getDashboardActivity,
} from "./api/dashboard";
import { getSchemaJournal } from "./api/schema-journal";
import { POST as emailSend } from "./api/email-send";
import { POST as emailSendWithTemplate } from "./api/email-send-template";
import {
  getGeneralSettings,
  updateGeneralSettings,
} from "./api/general-settings";
import {
  listImageSizes,
  getImageSizeById,
  createImageSize,
  updateImageSize,
  deleteImageSize,
} from "./api/image-sizes";
import type { SanitizedNextlyConfig } from "./collections/config/define-config";
import { container } from "./di/container";
import { withTimezoneFormatting } from "./lib/date-formatting";
import { createCorsMiddleware } from "./middleware/cors";
import { createRateLimiter } from "./middleware/rate-limit";
import { createSecurityHeadersMiddleware } from "./middleware/security-headers";
import {
  parseRestRoute,
  getActionFromMethod,
  getActionFromOperation,
  isPublicEndpoint,
  requiresAuthOnly,
  handleAuthRequest,
  getDispatcher,
  setHandlerConfig,
  getHandlerConfig,
} from "./route-handler";
import type { CollectionsHandler } from "./services/collections-handler";
import type { GeneralSettingsService } from "./services/general-settings/general-settings-service";
import {
  isSuperAdmin,
  containsSuperAdminRole,
  hasSuperAdminExcluding,
} from "./services/lib/permissions";
import {
  hexToHslTriplet,
  getForegroundForBackground,
  isValidHex,
} from "./utils/color-utils";

// ============================================================================
// Schema Version Header
// ============================================================================

// Global schema version counter for cross-flow notification.
// Bumped from collection-dispatcher.ts:applySchemaChanges after a
// successful pipeline apply (F8 PR 3 — was previously SchemaChangeService).
// The admin UI reads X-Nextly-Schema-Version from response headers
// and invalidates caches when the version increases.
let globalSchemaVersion = 0;

export function bumpSchemaVersion(): number {
  globalSchemaVersion++;
  return globalSchemaVersion;
}

function getSchemaVersionHeader(): number {
  return globalSchemaVersion;
}

// ============================================================================
// Global API Date/Time Formatting
// ============================================================================

async function applyGlobalDateFormatting(
  response: Response,
  req?: Request
): Promise<Response> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return response;
  }

  // Skip formatting for auth endpoints to avoid interfering with auth flow
  if (req) {
    const url = new URL(req.url);
    if (url.pathname.includes("/auth/")) {
      return response;
    }
  }

  return withTimezoneFormatting(response);
}

// ============================================================================
// Super-Admin Role Protection
// ============================================================================

/**
 * Prevent non-super-admins from assigning the super_admin role.
 *
 * Applies to three paths:
 * - createLocalUser: body.roles array
 * - updateUser: body.roles array
 * - assignRoleToUser: body.roleId
 *
 * @returns A 403 Response if protection triggers, or null if allowed.
 */
async function guardSuperAdminRoleAssignment(
  requestingUserId: string,
  method: string,
  body: unknown
): Promise<Response | null> {
  // Collect the role IDs being assigned
  let roleIdsToCheck: string[] = [];

  if (method === "createLocalUser" || method === "updateUser") {
    const b = body as Record<string, unknown> | undefined;
    if (Array.isArray(b?.roles) && (b.roles as unknown[]).length > 0) {
      roleIdsToCheck = b.roles as string[];
    }
  } else if (method === "assignRoleToUser") {
    const b = body as Record<string, unknown> | undefined;
    const roleId = b?.roleId as string | undefined;
    if (roleId) roleIdsToCheck = [roleId];
  }

  if (roleIdsToCheck.length === 0) return null;

  // Check if any role being assigned is super_admin
  const hasSuperAdmin = await containsSuperAdminRole(roleIdsToCheck);
  if (!hasSuperAdmin) return null;

  // Verify the requesting user is themselves a super-admin
  const callerIsSuperAdmin = await isSuperAdmin(requestingUserId);
  if (callerIsSuperAdmin) return null;

  return new Response(
    JSON.stringify({
      error: "Only super-admins can assign the super_admin role",
    }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Prevent removing the super_admin role from the last super-admin.
 *
 * Applies only to updateUser when the new roles array no longer includes
 * the super-admin role and the target user is currently a super-admin.
 *
 * @returns A 400 Response if protection triggers, or null if allowed.
 */
async function guardLastSuperAdminRemoval(
  targetUserId: string,
  method: string,
  body: unknown
): Promise<Response | null> {
  if (method !== "updateUser") return null;

  const b = body as Record<string, unknown> | undefined;
  if (!Array.isArray(b?.roles)) return null;

  const newRoles = b.roles as string[];

  // Only check if the super-admin role is being removed (not present in new roles)
  const newRolesContainSuperAdmin = await containsSuperAdminRole(newRoles);
  if (newRolesContainSuperAdmin) return null;

  // Check if the target user currently holds the super-admin role
  const targetIsSuperAdmin = await isSuperAdmin(targetUserId);
  if (!targetIsSuperAdmin) return null;

  // Check if any other user has the super-admin role
  const othersExist = await hasSuperAdminExcluding(targetUserId);
  if (othersExist) return null;

  return new Response(
    JSON.stringify({
      error:
        "Cannot remove the super_admin role: this user is the last super-admin. Assign the super_admin role to another user first.",
    }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
}

// ============================================================================
// API Key Direct Dispatch
// ============================================================================

/**
 * Delegate an API key request directly to the named handler.
 *
 * API key handlers manage their own auth + body parsing — they must NOT flow
 * through the standard resolveAuthorization() + body-read + dispatcher pipeline
 * because (a) they own their auth checks internally, and (b) consuming req.text()
 * before the handler runs would exhaust the body stream.
 */
async function handleApiKeyRequest(
  req: Request,
  method: string,
  routeParams: Record<string, string> | undefined
): Promise<Response> {
  const id = routeParams?.apiKeyId ?? "";
  switch (method) {
    case "listApiKeys":
      return listApiKeys(req);
    case "getApiKeyById":
      return getApiKeyById(req, id);
    case "createApiKey":
      return createApiKey(req);
    case "updateApiKey":
      return updateApiKey(req, id);
    case "revokeApiKey":
      return revokeApiKey(req, id);
    default:
      return new Response(
        JSON.stringify({ error: "Unknown API key operation" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
  }
}

/**
 * Delegate a general settings request directly to the named handler.
 * Handlers manage their own auth + body parsing.
 */
async function handleGeneralSettingsRequest(
  req: Request,
  httpMethod: string
): Promise<Response> {
  switch (httpMethod) {
    case "GET":
      return getGeneralSettings(req);
    case "PATCH": {
      return updateGeneralSettings(req);
    }
    default:
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
  }
}

/**
 * Delegate image sizes requests to the named handlers.
 * Handlers manage their own auth + body parsing.
 */
async function handleImageSizesRequest(
  req: Request,
  httpMethod: string,
  imageId?: string
): Promise<Response> {
  switch (httpMethod) {
    case "GET":
      return imageId ? getImageSizeById(req, imageId) : listImageSizes(req);
    case "POST":
      return createImageSize(req);
    case "PATCH":
      if (!imageId)
        return new Response(JSON.stringify({ error: "ID required" }), {
          status: 400,
        });
      return updateImageSize(req, imageId);
    case "DELETE":
      if (!imageId)
        return new Response(JSON.stringify({ error: "ID required" }), {
          status: 400,
        });
      return deleteImageSize(req, imageId);
    default:
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
  }
}

// ============================================================================
// Dashboard Direct Dispatch
// ============================================================================

/**
 * Delegate a dashboard request directly to the named handler.
 *
 * Dashboard handlers manage their own auth (requireAuthentication) and are
 * read-only (GET). Intercepting here — before req.text() — keeps the pattern
 * consistent with API keys and general settings.
 */
async function handleDashboardRequest(
  req: Request,
  method: string
): Promise<Response> {
  switch (method) {
    case "getDashboardStats":
      return getDashboardStats(req);
    case "getDashboardRecentEntries":
      return getDashboardRecentEntries(req);
    case "getDashboardActivity":
      return getDashboardActivity(req);
    default:
      return new Response(
        JSON.stringify({ error: "Unknown dashboard operation" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
  }
}

// ============================================================================
// Schema Direct Dispatch (F10 PR 4)
// ============================================================================

/**
 * Delegate a schema request directly to the named handler.
 *
 * Schema handlers own their auth (requireAuthentication + super-admin
 * gate). Read-only GET endpoints — no body to consume. Same intercept
 * pattern as dashboard / api-keys / general settings.
 */
async function handleSchemaRequest(
  req: Request,
  method: string
): Promise<Response> {
  switch (method) {
    case "getSchemaJournal":
      return getSchemaJournal(req);
    default:
      return new Response(
        JSON.stringify({ error: "Unknown schema operation" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
  }
}

// ============================================================================
// Email Direct Dispatch
// ============================================================================

/**
 * Delegate an email request directly to the existing email POST handlers.
 *
 * The handlers manage their own auth (requireAuthentication), body parsing,
 * Zod validation, and NextlyError mapping. Intercepting here —
 * before req.text() in handleServiceRequest — keeps the request body
 * stream available for the handler to consume.
 */
async function handleEmailRequest(
  req: Request,
  method: string
): Promise<Response> {
  switch (method) {
    case "send":
      return emailSend(req);
    case "sendWithTemplate":
      return emailSendWithTemplate(req);
    default:
      return new Response(
        JSON.stringify({ error: "Unknown email operation" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
  }
}

// ============================================================================
// Authorization Helpers
// ============================================================================

/** Collection entry methods that operate on collection data (not definitions). */
const COLLECTION_ENTRY_METHODS = new Set([
  "listEntries",
  "createEntry",
  "getEntry",
  "updateEntry",
  "deleteEntry",
  "bulkDeleteEntries",
  "bulkUpdateEntries",
  "bulkUpdateByQuery",
  "countEntries",
  "duplicateEntry",
]);

/** Single document methods (read/update content, not schema definitions). */
const SINGLE_DOCUMENT_METHODS = new Set([
  "getSingleDocument",
  "updateSingleDocument",
]);

/**
 * Centralized permission resolver for all API service endpoints.
 *
 * Determines the correct permission check for each service/method combination
 * and delegates to the appropriate middleware function.
 *
 * @returns Auth result — either `{ user }` on success or `ErrorResponse` on failure.
 */
async function resolveAuthorization(
  req: Request,
  service: string,
  method: string,
  operation: string,
  routeParams: Record<string, string> | undefined,
  httpMethod: string
): Promise<AuthContext | ErrorResponse> {
  // --- Collection endpoints ---
  if (service === "collections") {
    if (COLLECTION_ENTRY_METHODS.has(method)) {
      // Entry operations → {action}-{collectionSlug}
      const action = getActionFromOperation(operation);
      const slug = routeParams?.collectionName || "";
      return requireCollectionAccess(req, action, slug);
    }
    if (method === "getCollection") {
      const slug = routeParams?.collectionName || "";
      return requireCollectionAccess(req, "read", slug);
    }
    // Definition mutations (create/update/delete collection) → manage-settings
    return requirePermission(req, "manage", "settings");
  }

  // --- Singles endpoints ---
  if (service === "singles") {
    if (SINGLE_DOCUMENT_METHODS.has(method)) {
      // Document operations → {action}-{singleSlug}
      const action = method === "getSingleDocument" ? "read" : "update";
      const slug = routeParams?.slug || "";
      return requireCollectionAccess(req, action, slug);
    }
    if (method === "getSingleSchema") {
      const slug = routeParams?.slug || "";
      return requireCollectionAccess(req, "read", slug);
    }
    // Definition mutations (create/delete single, update schema) → manage-settings
    return requirePermission(req, "manage", "settings");
  }

  // --- Email providers → manage-email-providers ---
  if (service === "emailProviders") {
    const action = getActionFromMethod(httpMethod);
    return requireAnyPermission(req, [
      { action, resource: "email-providers" },
      { action: "manage", resource: "email-providers" },
    ]);
  }

  // --- Email templates → manage-email-templates ---
  if (service === "emailTemplates") {
    const action = getActionFromMethod(httpMethod);
    return requireAnyPermission(req, [
      { action, resource: "email-templates" },
      { action: "manage", resource: "email-templates" },
    ]);
  }

  // --- User fields → manage-settings ---
  if (service === "userFields") {
    const action = getActionFromMethod(httpMethod);
    return requireAnyPermission(req, [
      { action, resource: "settings" },
      { action: "manage", resource: "settings" },
    ]);
  }

  // --- Components → manage-settings ---
  if (service === "components") {
    const action = getActionFromMethod(httpMethod);
    return requireAnyPermission(req, [
      { action, resource: "settings" },
      { action: "manage", resource: "settings" },
    ]);
  }

  // --- RBAC: roles and permissions ---
  if (service === "rbac") {
    // listRolePermissions: allow read-roles or read-permissions
    // (role edit form needs this to populate the PermissionMatrix)
    if (method === "listRolePermissions") {
      return requireAnyPermission(req, [
        { action: "read", resource: "roles" },
        { action: "read", resource: "permissions" },
      ]);
    }

    // listPermissions: allow users with read-roles (for role form's permission matrix)
    if (method === "listPermissions") {
      return requireAnyPermission(req, [{ action: "read", resource: "roles" }]);
    }

    // addPermissionToRole, removePermissionFromRole → update-roles
    // (assigning/removing permissions from a role is a role update operation)
    if (
      method === "addPermissionToRole" ||
      method === "removePermissionFromRole"
    ) {
      return requirePermission(req, "update", "roles");
    }

    // addRoleInheritance, removeRoleInheritance → update-roles
    // (managing role hierarchy is a role update operation)
    if (method === "addRoleInheritance" || method === "removeRoleInheritance") {
      return requirePermission(req, "update", "roles");
    }

    // assignRoleToUser, unassignRoleFromUser → update-users
    // (role assignment is performed from the user edit form — a user management workflow)
    if (method === "assignRoleToUser" || method === "unassignRoleFromUser") {
      return requirePermission(req, "update", "users");
    }

    // getPermissionById: allow read-roles or read-permissions
    // (reading a single permission is needed for display and role editing)
    if (method === "getPermissionById") {
      return requireAnyPermission(req, [
        { action: "read", resource: "roles" },
        { action: "read", resource: "permissions" },
      ]);
    }

    // ensurePermission, updatePermission, deletePermissionById → manage-permissions (or CRUD)
    // (creating/modifying/deleting permissions requires the manage-permissions grant)
    if (
      method === "ensurePermission" ||
      method === "updatePermission" ||
      method === "deletePermissionById"
    ) {
      const action = getActionFromMethod(httpMethod);
      return requireAnyPermission(req, [
        { action, resource: "permissions" },
        { action: "manage", resource: "permissions" },
      ]);
    }

    // Default role CRUD: map HTTP method to action against "roles" resource
    // (listRoles, getRoleById, createRole, updateRole, deleteRole, etc.)
    const action = getActionFromMethod(httpMethod);
    return requirePermission(req, action, "roles");
  }

  // --- Default: {action}-{service} (e.g., read-users, create-users) ---
  const action = getActionFromMethod(httpMethod);
  return requirePermission(req, action, service);
}

// ============================================================================
// Service Request Handler
// ============================================================================

/**
 * Handle service requests with authentication and authorization
 */
async function handleServiceRequest(
  req: Request,
  params: string[],
  httpMethod: string
): Promise<Response> {
  // Extract search parameters from the request URL
  const url = new URL(req.url);
  const searchParams = url.searchParams;

  const { service, operation, method, routeParams } = parseRestRoute(
    params,
    httpMethod,
    searchParams
  );

  if (!service || !operation || !method) {
    return new Response(
      JSON.stringify({
        error:
          "Invalid REST route format. Check supported endpoints: /api/users, /api/roles, /api/permissions",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // ==================== API KEYS DIRECT DISPATCH ====================
  // API key handlers own their auth + body parsing. Intercepting here (before
  // req.text() is called below) ensures the body stream is still available.
  if (service === "apiKeys") {
    return handleApiKeyRequest(req, method, routeParams);
  }

  // ==================== GENERAL SETTINGS DIRECT DISPATCH ====================
  if (service === "generalSettings") {
    return handleGeneralSettingsRequest(req, httpMethod);
  }

  // ==================== IMAGE SIZES DIRECT DISPATCH ====================
  if (service === "imageSizes") {
    // Handle regeneration sub-routes
    // Regeneration endpoints return "not yet available" until the service
    // can actually download and reprocess original images from all adapters.
    if (method === "regenerationStatus" || method === "regenerate") {
      return Response.json(
        {
          data: {
            pending: 0,
            total: 0,
            inProgress: false,
            message: "Batch regeneration coming soon",
          },
        },
        { status: 200 }
      );
    }
    const imageId = routeParams?.imageId;
    return handleImageSizesRequest(req, httpMethod, imageId);
  }

  // ==================== DASHBOARD DIRECT DISPATCH ====================
  // Dashboard handlers own their auth (requireAuthentication). Read-only
  // endpoints — no body to consume, but keeping consistent dispatch pattern.
  if (service === "dashboard") {
    return handleDashboardRequest(req, method);
  }

  // ==================== SCHEMA DIRECT DISPATCH (F10 PR 4) ====================
  // Schema-journal handler owns its auth (requireAuthentication +
  // super-admin gate). Read-only GET — no body to consume.
  if (service === "schema") {
    return handleSchemaRequest(req, method);
  }

  // ==================== EMAIL DIRECT DISPATCH ====================
  // Email handlers own their auth (requireAuthentication) + body parsing.
  // Intercepting before req.text() keeps the body stream available.
  if (service === "email") {
    return handleEmailRequest(req, method);
  }

  // ==================== AUTHENTICATION & AUTHORIZATION ====================
  // Check if endpoint is public
  const isPublic = isPublicEndpoint(service, method);

  let authorizedUser: AuthContext | undefined;

  if (!isPublic) {
    // Check if this is /api/me endpoint - requires auth only
    if (params[0] === "me") {
      const authResult = await requireAuthentication(req);
      if (isErrorResponse(authResult)) {
        return createJsonErrorResponse(authResult);
      }
      // Add user ID to route params for /api/me endpoints
      if (routeParams) {
        routeParams.userId = authResult.userId;
      }
      authorizedUser = authResult;
    }
    // Check if endpoint requires auth only (no specific permission)
    else if (requiresAuthOnly(service, method)) {
      const authResult = await requireAuthentication(req);
      if (isErrorResponse(authResult)) {
        return createJsonErrorResponse(authResult);
      }
      authorizedUser = authResult;
    }
    // Require specific permission based on service/method/operation
    else {
      const authResult = await resolveAuthorization(
        req,
        service,
        method,
        operation,
        routeParams,
        httpMethod
      );
      if (isErrorResponse(authResult)) {
        return createJsonErrorResponse(authResult);
      }
      authorizedUser = authResult;
    }
  }

  // ==================== PARSE REQUEST BODY ====================
  let body: unknown = undefined;
  if (httpMethod === "POST" || httpMethod === "PUT" || httpMethod === "PATCH") {
    try {
      const text = await req.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // ==================== SUPER-ADMIN ROLE PROTECTION ====================
  if (authorizedUser) {
    const guardResult = await guardSuperAdminRoleAssignment(
      authorizedUser.userId,
      method,
      body
    );
    if (guardResult) return guardResult;

    // Prevent removing the super_admin role from the last super-admin
    const targetUserId = routeParams?.userId;
    if (targetUserId) {
      const lastSuperAdminGuard = await guardLastSuperAdminRemoval(
        targetUserId,
        method,
        body
      );
      if (lastSuperAdminGuard) return lastSuperAdminGuard;
    }
  }

  // ==================== DISPATCH REQUEST ====================
  // Inject the authenticated user's ID into route params so that downstream
  // service methods (e.g. createEntry, updateEntry, deleteEntry) can pass it
  // into hook contexts. Without this, activity-log hooks have no user and
  // are silently skipped.
  // NOTE: We use _authenticatedUserId (not userId) to avoid colliding with
  // the existing routeParams.userId which is the target user ID from URL params.
  if (authorizedUser && routeParams) {
    routeParams._authenticatedUserId = authorizedUser.userId;
    if (authorizedUser.userName)
      routeParams._authenticatedUserName = authorizedUser.userName;
    if (authorizedUser.userEmail)
      routeParams._authenticatedUserEmail = authorizedUser.userEmail;
  }

  const dispatchRequest: DispatchRequest = {
    service,
    operation,
    method,
    params: routeParams,
    body,
    userId: authorizedUser?.userId,
    request: req, // Pass request for accessing headers (IP, user-agent, etc.)
  };

  const dispatcher = await getDispatcher();
  const result = await dispatcher.dispatch(dispatchRequest);

  if (result.status === 204 || result.status === 205 || result.status === 304) {
    return new Response(null, { status: result.status });
  }

  // Build response headers with schema version for cross-flow notification.
  // Admin UI reads this header to detect external schema changes.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const schemaVersion = getSchemaVersionHeader();
  if (schemaVersion !== undefined) {
    headers["X-Nextly-Schema-Version"] = String(schemaVersion);
  }

  // Task 24 phase 4: collapse the dispatcher's triple-wrap to the
  // canonical envelope. Pre-task-24 the wire was
  //   { data: { success, status, data: <T>, message?, meta? } }
  // which forced consumers to read `result.data.<field>` after the
  // fetcher's single-`data` peel — and most of them got it wrong.
  // Now success responses follow the Task-21 spec (§10.2) shape:
  //   { data: <T>, meta?: <M> }                 // success
  //   { errors: [{ code, message }] }           // failure
  // Status code carries success/failure on the wire. Consumers read
  // `result.<field>` directly (or `.docs` / `.meta` for paginated
  // lists once those endpoints get migrated to PaginatedDocs<T>).
  if (!result.success) {
    const errorBody = {
      errors: [
        {
          code: "INTERNAL_ERROR",
          message: result.error ?? "An unexpected error occurred.",
        },
      ],
    };
    return new Response(JSON.stringify(errorBody), {
      status: result.status,
      headers,
    });
  }

  const successBody: Record<string, unknown> = { data: result.data };
  if (result.meta !== undefined) {
    successBody.meta = result.meta;
  }
  return new Response(JSON.stringify(successBody), {
    status: result.status,
    headers,
  });
}

// ============================================================================
// Admin Meta Handler
// ============================================================================

/**
 * GET /api/admin-meta
 *
 * Returns the admin branding configuration to the admin UI.
 * Public — no authentication required.
 * Colors are converted from user-supplied hex to HSL triplets here on the
 * server so the client only has to inject them as CSS variables.
 */
async function handleAdminMetaRequest(): Promise<Response> {
  const config = getHandlerConfig();
  const branding = config?.admin?.branding;

  const payload: Record<string, unknown> = {};

  if (branding?.logoUrl) payload.logoUrl = branding.logoUrl;
  if (branding?.logoUrlLight) payload.logoUrlLight = branding.logoUrlLight;
  if (branding?.logoUrlDark) payload.logoUrlDark = branding.logoUrlDark;
  if (branding?.logoText) payload.logoText = branding.logoText;
  if (branding?.favicon?.trim()) payload.favicon = branding.favicon.trim();

  // Builder visibility defaults to NODE_ENV:
  // - production => hidden
  // - non-production => visible
  // Host apps can still explicitly override using admin.branding.showBuilder.
  const resolvedShowBuilder =
    typeof branding?.showBuilder === "boolean"
      ? branding.showBuilder
      : process.env.NODE_ENV !== "production";

  payload.showBuilder = resolvedShowBuilder;

  const colors = branding?.colors;
  if (colors) {
    const resolved: Record<string, string> = {};

    if (colors.primary && isValidHex(colors.primary)) {
      resolved.primary = hexToHslTriplet(colors.primary);
      resolved.primaryForeground = getForegroundForBackground(colors.primary);
    }
    if (colors.accent && isValidHex(colors.accent)) {
      resolved.accent = hexToHslTriplet(colors.accent);
      resolved.accentForeground = getForegroundForBackground(colors.accent);
    }

    if (Object.keys(resolved).length > 0) {
      payload.colors = resolved;
    }
  }

  // Collect plugin metadata from registered plugins with host override resolution
  const pluginOverrides = config?.admin?.pluginOverrides;
  const plugins = (config?.plugins ?? []).map(plugin => {
    const pluginSlug = plugin.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const hostOverride = pluginOverrides?.[pluginSlug];

    // Shallow merge appearance: host override fields win, author defaults preserved
    const effectiveAppearance = hostOverride?.appearance
      ? { ...plugin.admin?.appearance, ...hostOverride.appearance }
      : plugin.admin?.appearance;

    // Resolve plugin collections from the plugin definition.
    // Plugins should set `collections` on the plugin object so the
    // admin-meta API can serve which collections belong to each plugin.
    const pluginCollections = plugin.collections ?? [];

    return {
      name: plugin.name,
      version: plugin.version,
      description: plugin.admin?.description,
      group: plugin.admin?.group, // kept for backward compat
      placement:
        hostOverride?.placement ??
        plugin.admin?.placement ??
        plugin.admin?.group ??
        "plugins",
      order: hostOverride?.order ?? plugin.admin?.order,
      after: hostOverride?.after ?? plugin.admin?.after,
      appearance: effectiveAppearance,
      collections: pluginCollections.map(c => c.slug),
    };
  });
  if (plugins.length > 0) {
    payload.plugins = plugins;
  }

  // Override config branding with DB values when available
  try {
    if (container.has("generalSettingsService")) {
      const svc = container.get<GeneralSettingsService>(
        "generalSettingsService"
      );
      const settings = await svc.getSettings();
      if (settings.applicationName) payload.logoText = settings.applicationName;
      if (settings.logoUrl) payload.logoUrl = settings.logoUrl;

      // Include custom sidebar groups for admin navigation
      const customGroups = svc.getCustomSidebarGroups(settings);
      console.log(
        "[ADMIN-META] customGroups from DB:",
        JSON.stringify(customGroups)
      );
      if (customGroups.length > 0) {
        payload.customGroups = customGroups;
      }

      // Plugin placement overrides removed — placement is now author-defined
      // via definePlugin({ admin: { placement } }) and host-overridable via
      // defineConfig({ admin: { pluginOverrides } }). See Plan 18.
    }
  } catch (err) {
    // DB not ready or table missing — fall back to config values silently
    console.error("[ADMIN-META] Error fetching settings from DB:", err);
  }

  // Canonical Task-21 envelope: { data: <payload> }. The dispatcher used to
  // wrap an extra { status, success, data } envelope which the migrated
  // fetcher no longer peels — see task 24 phase 1.
  return new Response(JSON.stringify({ data: payload }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * PATCH /api/admin-meta/sidebar-groups
 *
 * Replaces the custom sidebar groups array.
 * Auth: manage-settings permission.
 *
 * Body: { groups: [{ slug, name, icon? }, ...] }
 */
async function handleAdminMetaSidebarGroups(req: Request): Promise<Response> {
  try {
    const authResult = await requirePermission(req, "manage", "settings");
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const text = await req.text();
    const body = text ? JSON.parse(text) : {};
    const groups: unknown[] = Array.isArray(body.groups) ? body.groups : [];

    // Validate each group has slug + name
    const validated: Array<{ slug: string; name: string; icon?: string }> = [];
    for (const g of groups) {
      if (typeof g !== "object" || g === null) continue;
      const rec = g as Record<string, unknown>;
      if (typeof rec.slug === "string" && typeof rec.name === "string") {
        validated.push({
          slug: rec.slug,
          name: rec.name,
          ...(typeof rec.icon === "string" && { icon: rec.icon }),
        });
      }
    }

    if (!container.has("generalSettingsService")) {
      return new Response(
        JSON.stringify({ error: "Settings service not available" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }
    const svc = container.get<GeneralSettingsService>("generalSettingsService");
    const updated = await svc.updateCustomSidebarGroups(validated);

    // Canonical envelope: { data: <updated> } — see task 24 phase 1.
    return new Response(JSON.stringify({ data: updated }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update sidebar groups";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * PATCH /api/admin-meta/plugin-placements
 *
 * @deprecated Plugin placement overrides are no longer supported.
 * Placement is defined by the plugin author via `definePlugin({ admin: { placement } })`
 * and optionally overridden by the host developer via `defineConfig({ admin: { pluginOverrides } })`.
 * Returns 410 Gone.
 */
async function handleAdminMetaPluginPlacements(
  _req: Request
): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: "Gone",
      message:
        "Plugin placement overrides are no longer supported. " +
        "Placement is defined by the plugin author via definePlugin() " +
        "and optionally overridden by the host developer via defineConfig({ admin: { pluginOverrides } }).",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  );
}

// ============================================================================
// CRUD Handler Wrappers
// ============================================================================

async function handleGet(req: Request, params: string[]) {
  if (params[0] === "admin-meta") {
    return handleAdminMetaRequest();
  }
  if (params[0] === "dev-reload" && process.env.NODE_ENV === "development") {
    const { subscribeDevReload } = await import(
      "./runtime/dev-reload-broadcaster"
    );
    let unsub: (() => void) | undefined;
    const stream = new ReadableStream<string>({
      start(ctrl) {
        unsub = subscribeDevReload(ctrl);
        ctrl.enqueue(": keepalive\n\n");
      },
      cancel() {
        unsub?.();
      },
    });
    return new Response(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
  return handleServiceRequest(req, params, "GET");
}

async function handlePost(req: Request, params: string[]) {
  return handleServiceRequest(req, params, "POST");
}

async function handlePut(req: Request, params: string[]) {
  return handleServiceRequest(req, params, "PUT");
}

async function handlePatch(req: Request, params: string[]) {
  if (params[0] === "admin-meta" && params[1] === "sidebar-groups") {
    return handleAdminMetaSidebarGroups(req);
  }
  if (params[0] === "admin-meta" && params[1] === "plugin-placements") {
    return handleAdminMetaPluginPlacements(req);
  }
  return handleServiceRequest(req, params, "PATCH");
}

async function handleDelete(req: Request, params: string[]) {
  return handleServiceRequest(req, params, "DELETE");
}

// ============================================================================
// Route Detection
// ============================================================================

function isAuthRoute(params: string[]) {
  return params.length > 0 && params[0] === "auth";
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create dynamic HTTP method handlers for Next.js API routes.
 *
 * Pass your nextly config so that plugins (and their collections) are
 * registered automatically on first request. Without a config, services
 * are initialized with default settings only.
 *
 * @param options - Optional configuration
 * @param options.config - The nextly config object (from `defineConfig()`)
 * @returns Object with handlers for GET, POST, PUT, PATCH, DELETE, OPTIONS
 *
 * @example
 * ```typescript
 * import { createDynamicHandlers } from '@revnixhq/nextly';
 * import nextlyConfig from '../../../nextly.config';
 *
 * const handlers = createDynamicHandlers({ config: nextlyConfig });
 * export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = handlers;
 * ```
 */
export function createDynamicHandlers(options?: {
  config?: SanitizedNextlyConfig;
}) {
  // Store the config so ensureServicesInitialized() can use it
  if (options?.config) {
    setHandlerConfig(options.config);
  }

  // --- Security middleware (created once at init time, not per-request) ---
  const securityConfig = options?.config?.security;
  const applySecurityHeaders = createSecurityHeadersMiddleware(
    securityConfig?.headers
  );
  const cors = createCorsMiddleware(securityConfig?.cors);

  // --- Rate limiting middleware ---
  // Read from sanitized config (rateLimit is populated by defineConfig() with
  // defaults when the user does not explicitly set `enabled: false`).
  const rateLimitConfig = options?.config?.rateLimit as
    | Parameters<typeof createRateLimiter>[0]
    | undefined;
  // Audit C4 / T-005: the default keyGenerator needs the trust-proxy
  // settings so it can resolve a real client IP rather than blindly
  // trusting X-Forwarded-For. Inject from `security.trustProxy` +
  // TRUSTED_PROXY_IPS env unless the user supplied an override.
  const trustedProxyIpsFromEnv = (process.env.TRUSTED_PROXY_IPS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const checkRateLimit = createRateLimiter({
    enabled: true,
    ...(rateLimitConfig ?? {}),
    trustProxy:
      rateLimitConfig?.trustProxy ?? securityConfig?.trustProxy ?? false,
    trustedProxyIps:
      rateLimitConfig?.trustedProxyIps ?? trustedProxyIpsFromEnv,
  });

  /**
   * Wrap a handler with rate limiting, CORS, and security headers.
   *
   * Order:
   * 1. CORS preflight — if OPTIONS, return immediately with security headers
   * 2. Rate limit check — if exceeded, return 429 with security headers
   * 3. Run the actual handler
   * 4. Apply CORS headers to the response
   * 5. Apply security headers to the response
   */
  async function withSecurity(
    req: Request,
    handler: () => Promise<Response>
  ): Promise<Response> {
    // CORS preflight intercept
    const preflightResponse = cors.handlePreflight(req);
    if (preflightResponse) {
      return applySecurityHeaders(preflightResponse);
    }

    // Rate limit check — before running any handler logic
    const rateLimitResponse = await checkRateLimit(req);
    if (rateLimitResponse) {
      const corsRateLimited = cors.applyHeaders(req, rateLimitResponse);
      return applySecurityHeaders(corsRateLimited);
    }

    // Run the handler, then layer on CORS + security headers
    const response = await handler();
    const formattedResponse = await applyGlobalDateFormatting(response, req);
    const corsResponse = cors.applyHeaders(req, formattedResponse);
    return applySecurityHeaders(corsResponse);
  }

  return {
    GET: async (
      req: Request,
      ctx: { params: Promise<{ params?: string[] }> }
    ) => {
      const resolvedParams = await ctx.params;
      const paramsList = resolvedParams.params || [];
      return withSecurity(req, async () => {
        if (isAuthRoute(paramsList))
          return handleAuthRequest(req, paramsList, "GET");
        return handleGet(req, paramsList);
      });
    },
    POST: async (
      req: Request,
      ctx: { params: Promise<{ params?: string[] }> }
    ) => {
      const resolvedParams = await ctx.params;
      const paramsList = resolvedParams.params || [];
      return withSecurity(req, async () => {
        if (isAuthRoute(paramsList))
          return handleAuthRequest(req, paramsList, "POST");
        return handlePost(req, paramsList);
      });
    },
    PUT: async (
      req: Request,
      ctx: { params: Promise<{ params?: string[] }> }
    ) => {
      const resolvedParams = await ctx.params;
      const paramsList = resolvedParams.params || [];
      return withSecurity(req, async () => {
        return handlePut(req, paramsList);
      });
    },
    PATCH: async (
      req: Request,
      ctx: { params: Promise<{ params?: string[] }> }
    ) => {
      const resolvedParams = await ctx.params;
      const paramsList = resolvedParams.params || [];
      return withSecurity(req, async () => {
        if (isAuthRoute(paramsList))
          return handleAuthRequest(req, paramsList, "PATCH");
        return handlePatch(req, paramsList);
      });
    },
    DELETE: async (
      req: Request,
      ctx: { params: Promise<{ params?: string[] }> }
    ) => {
      const resolvedParams = await ctx.params;
      const paramsList = resolvedParams.params || [];
      return withSecurity(req, async () => {
        return handleDelete(req, paramsList);
      });
    },
    OPTIONS: async (req: Request) => {
      return withSecurity(req, async () => {
        return new Response(null, {
          status: 204,
          headers: { Allow: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
        });
      });
    },
  };
}

/**
 * Get the collections service directly
 * Useful for server-side access to collection operations
 *
 * This function first tries to get the CollectionService from the DI container
 * (set up via getNextly() or registerServices()), which supports dynamic schema
 * registration. Falls back to the dispatcher's container if DI is not set up.
 *
 * Returns undefined if the service is not yet available (DI container not
 * initialized and dispatcher adapter not configured).
 */
export function getCollectionsService() {
  // Get from DI container (supports dynamic schema registration)
  // Services must be initialized via registerServices() first
  try {
    if (container.has("collectionService")) {
      return container.get("collectionService");
    }
  } catch {
    // DI not initialized
  }

  // Services not initialized yet, return undefined
  return undefined;
}

/**
 * Get the collections handler directly
 *
 * This function returns the CollectionsHandler from the DI container,
 * which is the same instance used by the ServiceDispatcher. This ensures
 * that dynamic schemas registered here will be available to API route handlers.
 *
 * Use this when you need to register dynamic schemas for collection entries.
 *
 * Returns undefined if the handler is not yet available (DI container not
 * initialized and dispatcher adapter not configured). This is safe to check
 * before registering dynamic schemas.
 *
 * @example
 * ```typescript
 * import { getCollectionsHandler } from '@revnixhq/nextly';
 * import * as dynamicSchemas from '@/db/schemas/dynamic';
 *
 * const handler = getCollectionsHandler();
 * if (handler) {
 *   handler.registerDynamicSchemas(dynamicSchemas);
 * }
 * ```
 */
export function getCollectionsHandler(): CollectionsHandler | undefined {
  // Get from DI container (this is what the dispatcher uses)
  // Services must be initialized via registerServices() first
  try {
    if (container.has("collectionsHandler")) {
      return container.get<CollectionsHandler>("collectionsHandler");
    }
  } catch {
    // DI not initialized
  }

  // Services not initialized yet, return undefined
  // The caller should check for this and handle accordingly
  return undefined;
}
