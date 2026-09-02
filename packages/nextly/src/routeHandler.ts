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
 * import { createDynamicHandlers } from 'nextly';
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
import { actorFromAuthContext } from "@nextly/auth/request-actor";
import type { DispatchRequest } from "@nextly/services/dispatcher";

import {
  listApiKeys,
  getApiKeyById,
  createApiKey,
  updateApiKey,
  revokeApiKey,
} from "./api/api-keys";
import { readAccessCaller, readCaller } from "./api/authenticated-read";
import {
  getDashboardStats,
  getDashboardRecentEntries,
  getDashboardActivity,
} from "./api/dashboard";
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
import { listJobsRoute } from "./api/jobs-list-route";
import { runJobsRoute } from "./api/jobs-run-route";
import { mintPreviewLink, revokePreviewLinks } from "./api/preview-links";
import { resolveEntryPreviewUrl } from "./api/preview-url";
import { handleReleaseRequest } from "./api/releases";
import { readOrGenerateRequestId, withRequestIdHeader } from "./api/request-id";
// canonical respondX wire shapes (spec §5.1) instead of the
// hand-rolled `{ data: <payload> }` envelope.
import {
  SKIP_DATE_FORMATTING_HEADER,
  respondData,
  respondMutation,
} from "./api/response-shapes";
import { getSchemaJournal } from "./api/schema-journal";
import { getTranslationWorklist } from "./api/translations";
import {
  listWebhooks,
  getWebhookById,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  revealWebhookSecret,
  rotateWebhookSecret,
  expireWebhookOldSecrets,
  listWebhookDeliveries,
  getWebhookDelivery,
  testWebhookEndpoint,
  redeliverWebhookDelivery,
  drainWebhooks,
} from "./api/webhooks";
import {
  deleteWidgetLayout,
  getWidgetLayout,
  putWidgetLayout,
} from "./api/widget-layout";
import { postWidgetQuery } from "./api/widget-query";
import { readAccessTokenCookie } from "./auth/cookies/access-token-cookie";
import type { SanitizedNextlyConfig } from "./collections/config/define-config";
import { container } from "./di/container";
import { contributedWidgets } from "./domains/widgets/canonical";
import {
  generatedCollectionSlug,
  generatedWidgets,
  readableGeneratedWidgets,
  refreshCollectionWidgets,
} from "./domains/widgets/collection-widgets";
import type { WidgetDefinition } from "./domains/widgets/definition";
import { publishableWidgets } from "./domains/widgets/publish";
import { readableCollections } from "./domains/widgets/visibility";
import { NextlyError } from "./errors/nextly-error";
import {
  currentFlattenedErrors,
  logFlattenedErrors,
  withSideEffectWarnings,
} from "./hooks/side-effect-warnings";
import { withTimezoneFormatting } from "./lib/date-formatting";
import { createCorsMiddleware } from "./middleware/cors";
import { createRateLimiter } from "./middleware/rate-limit";
import { createSecurityHeadersMiddleware } from "./middleware/security-headers";
import { buildPluginAdminMeta } from "./plugins/admin-meta";
import { runPluginRoute } from "./plugins/routes/dispatch";
import { getPluginRouteRegistry } from "./plugins/routes/route-registry";
import { assertAdminWidgets } from "./plugins/validate-admin-widgets";
import { assertClientConfigs } from "./plugins/validate-client-config";
import {
  parseRestRoute,
  getActionFromMethod,
  getActionFromOperation,
  isPublicEndpoint,
  requiresAuthOnly,
  handleAuthRequest,
  getDispatcher,
  ensureServicesInitialized,
  setHandlerConfig,
  getHandlerConfig,
} from "./route-handler";
import { handleDevSchemaRequest } from "./route-handler/dev-schema-handler";
import { registerNextCacheRevalidator } from "./runtime/cache/register";
import type { CollectionsHandler } from "./services/collections-handler";
import type { GeneralSettingsService } from "./services/general-settings/general-settings-service";
import {
  isSuperAdmin,
  containsSuperAdminRole,
  hasSuperAdminExcluding,
  resolveRoleSlugs,
} from "./services/lib/permissions";
import {
  builderDisabledError,
  isBuilderEnabled,
  isBuilderRoute,
} from "./shared/builder-access";
import {
  hexToCssColor,
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

/**
 * Marks a response the global date/time pass must leave alone.
 *
 * That pass renders CONTENT timestamps in the viewer's timezone. A payload of
 * configuration carries none, so every date-like string in it is opaque text
 * belonging to whoever wrote it — a plugin's `clientConfig` most clearly, which
 * is promised to arrive exactly as declared. Rewriting `"2026-08-04T12:34Z"`
 * into a normalised, timezone-shifted form breaks that promise for a value the
 * pass cannot know the meaning of.
 *
 * A header rather than a path test: the handler knows what it is returning,
 * whereas a path can be matched by a plugin route that happens to end in the
 * same segment and should keep its ordinary formatting.
 */

async function applyGlobalDateFormatting(
  response: Response,
  req?: Request
): Promise<Response> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return response;
  }

  // A response that opted out. Marked by the handler rather than matched by
  // path: a plugin may mount its own route ending in the same segment, and it
  // should keep the formatting every other plugin response gets. The header is
  // internal, so it is removed on the way out.
  if (response.headers.has(SKIP_DATE_FORMATTING_HEADER)) {
    const headers = new Headers(response.headers);
    headers.delete(SKIP_DATE_FORMATTING_HEADER);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
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
 * Services whose handlers own their auth and body parsing and therefore return
 * before the shared dispatcher path. Kept beside those branches: a service
 * added there without being added here silently loses cold-boot initialisation.
 */
const DIRECT_DISPATCH_SERVICES = new Set<string>([
  "apiKeys",
  "webhooks",
  "releases",
  "jobs",
  "generalSettings",
  "previewLinks",
  "previewUrl",
  "imageSizes",
  "dashboard",
  "translations",
  "schema",
  "email",
]);

/**
 * Route a parsed webhook operation to its handler.
 *
 * Mirrors the API-key dispatch: the handlers own their own auth and body
 * parsing, so this only maps the method name.
 */
async function handleWebhookRequest(
  req: Request,
  method: string,
  routeParams: Record<string, string> | undefined
): Promise<Response> {
  const id = routeParams?.webhookId ?? "";
  switch (method) {
    case "listWebhooks":
      return listWebhooks(req);
    case "getWebhookById":
      return getWebhookById(req, id);
    case "createWebhook":
      return createWebhook(req);
    case "updateWebhook":
      return updateWebhook(req, id);
    case "deleteWebhook":
      return deleteWebhook(req, id);
    case "revealWebhookSecret":
      return revealWebhookSecret(req, id);
    case "rotateWebhookSecret":
      return rotateWebhookSecret(req, id);
    case "expireWebhookOldSecrets":
      return expireWebhookOldSecrets(req, id);
    case "listWebhookDeliveries":
      return listWebhookDeliveries(req, id);
    case "getWebhookDelivery":
      return getWebhookDelivery(req, id, routeParams?.deliveryId ?? "");
    case "testWebhookEndpoint":
      return testWebhookEndpoint(req, id);
    case "redeliverWebhookDelivery":
      return redeliverWebhookDelivery(req, id, routeParams?.deliveryId ?? "");
    case "drainWebhooks":
      return drainWebhooks(req);
    default:
      return new Response(
        JSON.stringify({ error: "Unknown webhook operation" }),
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
    case "postWidgetQuery":
      return postWidgetQuery(req);
    case "getWidgetLayout":
      return getWidgetLayout(req);
    case "putWidgetLayout":
      return putWidgetLayout(req);
    case "deleteWidgetLayout":
      return deleteWidgetLayout(req);
    default:
      return new Response(
        JSON.stringify({ error: "Unknown dashboard operation" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
  }
}

// ============================================================================
// Translations Direct Dispatch
// ============================================================================

/**
 * Delegate a translation-worklist request to its handler.
 *
 * One method today. Kept as a switch rather than a direct call so a second
 * read (a per-language count, say) lands beside it instead of growing another
 * dispatch branch above.
 */
async function handleTranslationsRequest(
  req: Request,
  method: string
): Promise<Response> {
  switch (method) {
    case "getTranslationWorklist":
      return getTranslationWorklist(req);
    default:
      return new Response(
        JSON.stringify({ error: "Unknown translations operation" }),
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

/**
 * Collection entry methods that operate on collection data (not definitions).
 *
 * Membership decides which permission a method resolves to, and the fallthrough
 * is not a refusal: a method absent from this set lands on the definition branch
 * and demands `manage-settings`. That denies the editors who hold
 * `update-{slug}` and grants the request to a caller who holds settings but no
 * access to the collection, so an omission fails in both directions at once.
 * Exported so the route-parser suite can assert every entry route's method
 * against it rather than restating the list.
 */
export const COLLECTION_ENTRY_METHODS = new Set([
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
  "publishAllLocales",
  "unpublishAllLocales",
  // Version history is guarded by the same per-collection read permission as
  // the entry itself; the document-level rules run inside the methods.
  "listEntryVersions",
  "getEntryVersion",
  "getEntryVersionDiff",
  // Restoring writes the document, so the route parser marks it an `update`
  // operation and this resolves to the `update-{slug}` permission.
  "restoreEntryVersion",
  // Naming a version writes history rather than the document, but it is still
  // a write and resolves to the same permission.
  "setEntryVersionLabel",
  // Discarding the working draft reverts the document to its live row; the
  // route parser marks it an `update` operation, so it resolves to the
  // `update-{slug}` permission rather than a definition mutation's manage-settings.
  "discardWorkingDraft",
  // Storing a recovery point writes the entry's content into history, so it is
  // authorized as an update of the entry like a discard is.
  "autosaveEntry",
  // Reading one back is a read of the entry's own content.
  "getEntryAutosave",
]);

/**
 * Single document methods (read/update content, not schema definitions).
 *
 * Carries the same fallthrough hazard as `COLLECTION_ENTRY_METHODS` above.
 */
export const SINGLE_DOCUMENT_METHODS = new Set([
  "getSingleDocument",
  "updateSingleDocument",
  // Read-only history for the document, guarded by the same read permission.
  "listSingleVersions",
  "getSingleVersion",
  "getSingleVersionDiff",
  // A write, authorized as an update of the document.
  "restoreSingleVersion",
  // Also a write. Deliberately absent from the read allowlist below, so the
  // action resolves to `update` by default.
  "setSingleVersionLabel",
  // A write for the same reason as the collection entry's autosave, and left
  // out of the read branch below so it resolves to `update`.
  "autosaveSingle",
  // The matching read. Named in the read branch below, so it resolves to
  // `read` rather than demanding update permission by sharing this set.
  "getSingleAutosave",
  // Publishing every language writes the document's status, so the route parser
  // marks it an `update` and this resolves it to `update-{slug}` rather than a
  // definition mutation's manage-settings. The service checks `publish-{slug}`
  // on top, which no route-level gate can express.
  "publishAllSingleLocales",
  // Discarding the working draft reverts the document to its live row. Left out
  // of the read branch below so it resolves to `update-{slug}`: a caller who may
  // not update the document may not throw away its pending edits either.
  "discardSingleWorkingDraft",
]);

/**
 * Read methods that still need resolved role slugs, even though reads normally
 * skip the lookup.
 *
 * Every method here evaluates the caller's stored access rules through
 * `checkCollectionAccess`, which reads roles twice over: the super-admin bypass
 * is keyed on the role set (`isSuperAdminContext`), and stored role-based rules
 * match against the roles forwarded in the request context. A caller arriving
 * without roles is therefore treated as a non-super-admin holding no roles, so
 * a role-based rule denies a legitimately permitted reader and a super-admin
 * loses the bypass and gets owner-filtered instead.
 *
 * The version methods surface that denial as a 404, since their gate does not
 * disclose existence, and the two version `get*` methods additionally return a
 * snapshot redacted by field-level `access.read`, which reads the same set.
 *
 * The entry and Single document reads are here because they forward the caller
 * into their query service, which evaluates the entity's stored read rules for
 * them.
 * Resolving roles costs a permissions lookup on every entry read; a read that
 * silently ignores the rule it was configured with is the worse tradeoff.
 */
const ROLE_AWARE_READ_METHODS = new Set([
  // The autosave reads evaluate the document's stored access rules through the
  // same gate the version reads use, so they need resolved roles for the same
  // reason: without them a caller arrives as a non-super-admin holding no
  // roles, and a role-based rule answers not-found for the author whose own
  // recovery point it is.
  "getEntryAutosave",
  "getSingleAutosave",
  "listEntries",
  "getEntry",
  "countEntries",
  "getSingleDocument",
  "listEntryVersions",
  "getEntryVersion",
  "getEntryVersionDiff",
  "listSingleVersions",
  "getSingleVersion",
  "getSingleVersionDiff",
]);

/**
 * Decide whether a request needs its role slugs resolved before dispatch.
 *
 * Resolving roles costs a permissions query for session auth, so it is opt-in:
 * collection and single mutations consume them for hook context and access
 * rules, and the reads in {@link ROLE_AWARE_READ_METHODS} consume them to
 * evaluate stored rules. Every other route reads no roles and must not pay for
 * the lookup.
 */
function needsResolvedRoles(
  service: string,
  method: string,
  httpMethod: string
): boolean {
  if (ROLE_AWARE_READ_METHODS.has(method)) return true;
  if (service !== "collections" && service !== "singles") return false;
  return (
    httpMethod !== "GET" && httpMethod !== "HEAD" && httpMethod !== "OPTIONS"
  );
}

export const _needsResolvedRolesForTest = needsResolvedRoles;

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
      // Document operations → {action}-{singleSlug}. The read-only methods
      // must not demand update permission just by sharing this set.
      const action =
        method === "getSingleDocument" ||
        method === "listSingleVersions" ||
        method === "getSingleVersion" ||
        method === "getSingleVersionDiff" ||
        method === "getSingleAutosave"
          ? "read"
          : "update";
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
    // The provider catalog is the one read a CREATOR also needs. The
    // permissions are seeded independently, so a role holding only
    // create-email-providers can POST a provider and would otherwise be denied
    // the descriptors describing which fields that provider requires --
    // leaving the grant unusable for exactly the contributed providers the
    // catalog exists to describe. It exposes definitions, never stored records.
    if (method === "listProviderTypes") {
      return requireAnyPermission(req, [
        { action: "read", resource: "email-providers" },
        { action: "create", resource: "email-providers" },
        { action: "manage", resource: "email-providers" },
      ]);
    }

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

  // --- Field groups → manage-settings ---
  if (service === "field-groups") {
    // 🔴 The HTTP verb is a PROXY for the action, and these two methods are where the proxy is
    // wrong: both travel over POST while rewriting an EXISTING definition. Verb-derived
    // authorization therefore demands `create` from a principal who may only update — and, in the
    // direction that matters, lets a create-only principal rewrite definitions they may not touch.
    // The route parser already classifies both as `update`; this map is what makes the permission
    // agree with that classification rather than re-deriving a second, contradictory answer.
    const FIELD_GROUP_ACTION_OVERRIDES: Readonly<Record<string, string>> = {
      applyComponentSchemaChanges: "update",
      reconcileComponent: "update",
      // The one entry here that makes the requirement STRICTER than its verb rather than merely
      // correcting it: a GET would otherwise resolve to `read`. The repair plan exposes live
      // column shapes and the drift against the stored definition, so it takes the permission the
      // repair takes — a principal who may only read definitions must not enumerate that.
      previewComponentReconcile: "update",
    };
    const action =
      FIELD_GROUP_ACTION_OVERRIDES[method] ?? getActionFromMethod(httpMethod);
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

  // Plugin-contributed routes (D25), namespaced under /plugins/<name>. They own
  // their secure-by-default auth (D28) and are matched BEFORE the built-in REST
  // router (which would 400 on these paths). The verb wrappers' withSecurity()
  // already applies CORS/rate-limit/headers around this.
  const pluginRouteMatch = getPluginRouteRegistry().match(
    httpMethod,
    "/" + params.join("/")
  );
  if (pluginRouteMatch) {
    return runPluginRoute(req, pluginRouteMatch);
  }

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

  // The builder writes DDL straight to the live database, so it is off in
  // production by default. Refuse its routes here, at the one point every
  // dispatched request passes through — hiding the navigation would still
  // leave these reachable by URL. Entry CRUD is untouched, and boot-time
  // code-first sync goes through the registry services, not this dispatcher.
  //
  // Returned rather than thrown: this runs outside the dispatcher's
  // NextlyError-to-response mapping, so a throw would surface as a 500.
  if (isBuilderRoute(service, method) && !isBuilderEnabled()) {
    const err = builderDisabledError(`${service}.${method}`);
    const requestId = readOrGenerateRequestId(req);
    return new Response(
      JSON.stringify({ error: err.toResponseJSON(requestId) }),
      {
        status: err.statusCode,
        headers: {
          "content-type": "application/problem+json",
          "x-request-id": requestId,
        },
      }
    );
  }

  // The direct-dispatch handlers below resolve their own services through
  // `getCachedNextly()`, which does not boot anything — it throws when nothing
  // has initialised yet. Ordinary REST requests are saved by `getDispatcher()`
  // further down, but these branches return before reaching it, so an app that
  // cold-boots through `createDynamicHandlers({ config })` with no
  // instrumentation would fail its first request to any of them.
  //
  // Scoped to those services rather than run unconditionally: everything else
  // passes through the authorization block below first, and initialising ahead
  // of it would let an unauthenticated request connect the database and run
  // startup work before being turned away with a 401.
  //
  // Deferred again until the request at least presents a credential. Both
  // credential sources are read without touching the container
  // (`readAccessTokenCookie` is a cookie parse, `authorization` a header read),
  // and a request carrying neither is refused by the handler's own auth without
  // ever resolving a service — so booting for it would hand unauthenticated
  // traffic a cold start it could not otherwise cause. A credential that turns
  // out to be invalid still boots, which only costs the warm-up a valid request
  // would have caused anyway.
  if (
    service !== undefined &&
    DIRECT_DISPATCH_SERVICES.has(service) &&
    (req.headers.get("authorization") !== null ||
      readAccessTokenCookie(req) !== null)
  ) {
    await ensureServicesInitialized();
  }

  // ==================== API KEYS DIRECT DISPATCH ====================
  // API key handlers own their auth + body parsing. Intercepting here (before
  // req.text() is called below) ensures the body stream is still available.
  if (service === "apiKeys") {
    return handleApiKeyRequest(req, method, routeParams);
  }

  // ==================== WEBHOOKS DIRECT DISPATCH ====================
  // Same reasoning as API keys: the handlers own their auth + body parsing, so
  // this must stay above the req.text() below or the body stream is consumed
  // before they can read it.
  if (service === "webhooks") {
    return handleWebhookRequest(req, method, routeParams);
  }

  // ==================== CONTENT RELEASES DIRECT DISPATCH ====================
  // Beside the handlers above and for the same reason: it owns its auth and
  // parses its own JSON, so it must stay above the shared body read below or
  // the stream reaches it consumed.
  if (service === "releases") {
    return handleReleaseRequest(req, method, routeParams);
  }

  // ==================== JOBS DIRECT DISPATCH ====================
  // Beside the webhook drain and for the same reason: the handler owns its own
  // authorization, and it must stay above the shared body read below.
  if (service === "jobs") {
    // Branch on the parsed method rather than the HTTP verb: the trigger
    // accepts GET as well, so a verb test would send a list request to the
    // runner and drain the queue as a side effect of reading it.
    // Matched explicitly, both ways. A ternary would make the SIDE-EFFECTING
    // runner the default, so a jobs route added later — or a method name
    // mistyped in the parser — would drain the queue instead of failing. The
    // dangerous operation must never be what an unrecognised name falls into.
    if (method === "listJobs") return listJobsRoute(req);
    if (method === "runJobs") return runJobsRoute(req);
    throw NextlyError.notFound({
      message: `Unknown jobs operation: ${method}`,
      logContext: { service: "jobs", method },
    });
  }

  // ==================== PREVIEW LINKS DIRECT DISPATCH ====================
  // Above the body read below, like the handlers beside it: these parse their
  // own JSON, and a consumed stream would reach them empty.
  if (service === "previewLinks") {
    return method === "revokePreviewLinks"
      ? revokePreviewLinks(req)
      : mintPreviewLink(req);
  }

  // ==================== PREVIEW URL DIRECT DISPATCH ====================
  // Beside the handlers above and for the same reason: it parses its own JSON,
  // and the shared body read below would leave the stream empty.
  if (service === "previewUrl") {
    return resolveEntryPreviewUrl(req);
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
  // Dashboard handlers own their auth (requireAuthentication). Intercepting
  // here keeps the pattern consistent with API keys and general settings; the
  // GET endpoints have no body, and postWidgetQuery and putWidgetLayout read
  // their own via req.json() before anything else touches the stream.
  if (service === "dashboard") {
    return handleDashboardRequest(req, method);
  }

  // ==================== TRANSLATIONS DIRECT DISPATCH ====================
  // Owns its auth (requireAuthentication) and is read-only, so it intercepts
  // here for the same reason dashboard does: before `req.text()`, which a GET
  // has no body for.
  if (service === "translations") {
    return handleTranslationsRequest(req, method);
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
  await setAuthenticatedRouteParams(
    routeParams,
    authorizedUser,
    needsResolvedRoles(service, method, httpMethod)
  );

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

  //
  //   { error: { code, message, messageKey?, data?, requestId } }
  //
  // Pre-Phase-4 the dispatcher emitted plural { errors: [...] } and
  // parseApiError on the admin client only read singular `error`,
  // silently degrading to "Unexpected response from server." See spec §6.4.
  //
  // The original NextlyError flows through DispatchResult.error
  // (propagated, not stringified), so we can rebuild the response
  // with the correct status, code, publicData, and headers (Retry-After
  // for rate limits, X-Request-Id always).
  if (!result.success) {
    const requestId = readOrGenerateRequestId(req);
    // The dispatcher (post-Phase-4) always sets `error` to a NextlyError
    // when `success` is false. The fallback covers a paranoid corner.
    const nextlyErr = NextlyError.is(result.error)
      ? result.error
      : NextlyError.internal();

    // Phase 4 follow-up (post-merge): emit an operator-facing log line
    // mirroring withErrorHandler's pattern (api/with-error-handler.ts).
    // Without this, dispatcher errors leave nothing in the terminal
    // beyond `PATCH ... 500`, making 5xx triage essentially impossible.
    // Skip logging for benign expected errors (NOT_FOUND, RATE_LIMITED,
    // AUTH_REQUIRED) so the log doesn't get flooded by unauth probes.
    const benignCodes = new Set(["NOT_FOUND", "RATE_LIMITED", "AUTH_REQUIRED"]);
    if (!benignCodes.has(String(nextlyErr.code))) {
      try {
        // Lazy-import the logger to avoid pulling it onto the cold path
        // for paths that never error.
        const { getNextlyLogger } = await import("./observability/logger");
        getNextlyLogger().error({
          kind: "dispatcher-error",
          ...nextlyErr.toLogJSON(requestId),
          route: new URL(req.url).pathname,
          method: req.method,
          service: dispatchRequest.service,
          operation: dispatchRequest.operation,
          dispatchMethod: dispatchRequest.method,
        });
      } catch {
        // If the logger itself throws, swallow; we still want to emit
        // the user-facing error response below.
      }
    }

    const errorHeaders: Record<string, string> = {
      "content-type": "application/problem+json",
      "x-request-id": requestId,
    };
    if (schemaVersion !== undefined) {
      errorHeaders["X-Nextly-Schema-Version"] = String(schemaVersion);
    }
    if (nextlyErr.code === "RATE_LIMITED") {
      const data = nextlyErr.publicData;
      if (
        data &&
        typeof data === "object" &&
        "retryAfterSeconds" in data &&
        typeof (data as { retryAfterSeconds?: unknown }).retryAfterSeconds ===
          "number"
      ) {
        errorHeaders["retry-after"] = String(
          (data as { retryAfterSeconds: number }).retryAfterSeconds
        );
      }
    }
    // A REFUSAL from a session-private read must not be cacheable either. The
    // success path already carries these headers, but a shared cache holding
    // the 404 this produces would replay it to a caller the gate WOULD have
    // allowed -- hiding their own recovery point rather than exposing anyone
    // else's. The failure direction is availability, and it is the one a
    // success-only fix leaves open.
    if (SESSION_PRIVATE_METHODS.has(method)) {
      return withSessionCacheHeaders(
        new Response(
          JSON.stringify({ error: nextlyErr.toResponseJSON(requestId) }),
          { status: nextlyErr.statusCode, headers: errorHeaders }
        )
      );
    }
    return new Response(
      JSON.stringify({ error: nextlyErr.toResponseJSON(requestId) }),
      {
        status: nextlyErr.statusCode,
        headers: errorHeaders,
      }
    );
  }

  // Phase 4: dispatcher handlers migrated via respondX helpers return
  // a Response directly (body + status + content-type already set).
  // Just attach the schema-version header (and any other route-level
  // metadata) and return it.
  if (result.data instanceof Response) {
    const response = result.data;
    if (schemaVersion !== undefined) {
      response.headers.set("X-Nextly-Schema-Version", String(schemaVersion));
    }
    return response;
  }

  // Legacy path for unmigrated handlers :
  // wrap whatever data they returned in { data, meta }. This is
  // gone after the migration is complete and `respondX` is the only
  // way to build a body in the dispatcher path.
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
 * The admin metadata, separated by the audience each half is answerable to.
 *
 * `branding` is what the sign-in screen draws with, so it has to be readable
 * before a session exists. `workspace` describes the authenticated admin —
 * which plugins are mounted, what they contribute, the configured locales and
 * the sidebar groups — and none of it is needed to render a login form.
 *
 * Built together and returned apart so each field has ONE implementation. A
 * second builder for the authenticated route would agree on the day it was
 * written and drift afterwards, and the drift is invisible because both halves
 * look correct alone.
 */
async function buildAdminMeta(
  /**
   * Cards core DERIVED for this reader's readable collections.
   *
   * A parameter rather than a call, because which of them a reader may be told
   * about depends on the reader and this builder is shared with the PUBLIC
   * branding route. Empty for that route, which discards `workspace` anyway.
   */
  generatedForCaller: WidgetDefinition[] = []
): Promise<{
  branding: Record<string, unknown>;
  workspace: Record<string, unknown>;
}> {
  const config = getHandlerConfig();
  const configuredBranding = config?.admin?.branding;

  const branding: Record<string, unknown> = {};
  const workspace: Record<string, unknown> = {};

  if (configuredBranding?.logoUrl)
    branding.logoUrl = configuredBranding.logoUrl;
  if (configuredBranding?.logoUrlLight)
    branding.logoUrlLight = configuredBranding.logoUrlLight;
  if (configuredBranding?.logoUrlDark)
    branding.logoUrlDark = configuredBranding.logoUrlDark;
  if (configuredBranding?.logoText)
    branding.logoText = configuredBranding.logoText;
  if (configuredBranding?.favicon?.trim())
    branding.favicon = configuredBranding.favicon.trim();

  // Colors are resolved to complete CSS colors here rather than in the client,
  // because the `--nx-*` tokens are consumed directly by the theme: a bare
  // "H S% L%" triplet is an invalid value and gets dropped.
  const colors = configuredBranding?.colors;
  if (colors) {
    const resolved: Record<string, string> = {};

    if (colors.primary && isValidHex(colors.primary)) {
      resolved.primary = hexToCssColor(colors.primary);
      resolved.primaryForeground = getForegroundForBackground(colors.primary);
    }
    if (colors.accent && isValidHex(colors.accent)) {
      resolved.accent = hexToCssColor(colors.accent);
      resolved.accentForeground = getForegroundForBackground(colors.accent);
    }

    if (Object.keys(resolved).length > 0) {
      branding.colors = resolved;
    }
  }

  // Same resolver the schema-mutation endpoints enforce with, so what the
  // admin renders and what the API accepts can never disagree.
  workspace.showBuilder = isBuilderEnabled();

  // Content-localization config for the admin (present only when i18n is enabled).
  const localization = config?.localization;
  if (localization) {
    workspace.locales = {
      defaultLocale: localization.defaultLocale,
      fallback: localization.fallback,
      locales: localization.locales,
    };
  }

  // Collect plugin metadata from registered plugins with host override
  // resolution + contributes.admin menu/pages/settings folding (D20/D21/D49).
  const pluginOverrides = config?.admin?.pluginOverrides;
  const plugins = buildPluginAdminMeta(config?.plugins ?? [], pluginOverrides);
  if (plugins.length > 0) {
    workspace.plugins = plugins;

    // A plugin may contribute components to the SIGN-IN screen, and those
    // read their own `clientConfig` through the plugin SDK before a session
    // exists. That channel is public by declaration — it never holds secrets
    // — so it is projected here rather than withheld.
    //
    // Built by naming the two fields it carries rather than by removing the
    // rest: a contribution field added later is then absent from this
    // projection by construction, which is the same reason the public
    // payload is a separate half rather than a filtered copy of the whole.
    //
    // Under its OWN key, never `plugins`. The client merges the two halves,
    // so sharing a key would let these entries stand in for the installed
    // list before the gated request answers — and a reader that finds a
    // plugin there has already skipped the checks that would have told it
    // the list is not available yet.
    const publicPlugins = plugins
      .filter(plugin => plugin.clientConfig !== undefined)
      .map(plugin => ({
        name: plugin.name,
        clientConfig: plugin.clientConfig,
      }));
    if (publicPlugins.length > 0) {
      branding.pluginClientConfigs = publicPlugins;
    }
  }

  // The widget REGISTRY, beside the contributions above. The two are different
  // channels to the same grid and neither subsumes the other: a contribution is
  // DECLARED in `contributes.admin.widgets` and travels with the plugin's
  // config, while a registration is an imperative `registerWidget` call made
  // during boot. Serializing only the first left an app that used the public
  // registration API invisible to the renderer built around that registry --
  // its card never drew and its query never entered the batch.
  //
  // Only this half of the payload can carry it. The registry is populated
  // during boot, and `handleAdminMetaWorkspaceRequest` is the caller that
  // awaits `ensureServicesInitialized()` first; the public branding route is
  // served without it and would answer from an empty store. That the workspace
  // half already describes the RUNNING installation rather than the configured
  // one -- `showBuilder` from the live resolver, `customGroups` from the
  // database -- is the same property this relies on.
  const widgets = [...publishableWidgets(), ...generatedForCaller];
  if (widgets.length > 0) {
    workspace.widgets = widgets;
  }

  // Override config branding with DB values when available
  try {
    if (container.has("generalSettingsService")) {
      const svc = container.get<GeneralSettingsService>(
        "generalSettingsService"
      );
      const settings = await svc.getSettings();
      if (settings.applicationName)
        branding.logoText = settings.applicationName;
      if (settings.logoUrl) branding.logoUrl = settings.logoUrl;

      // Include custom sidebar groups for admin navigation
      const customGroups = svc.getCustomSidebarGroups(settings);
      if (customGroups.length > 0) {
        workspace.customGroups = customGroups;
      }

      // Plugin placement overrides removed — placement is now author-defined
      // via definePlugin({ admin: { placement } }) and host-overridable via
      // defineConfig({ admin: { pluginOverrides } }).
    }
  } catch (err) {
    // DB not ready or table missing — fall back to config values silently
    console.error("[ADMIN-META] Error fetching settings from DB:", err);
  }

  return { branding, workspace };
}

/**
 * Serialize an admin-meta payload.
 *
 * `respondData` (bare object): this is a non-CRUD read and the admin client
 * consumes a bare body via the migrated fetcher. It requires a Record-shaped
 * argument, which both halves are built as, so the bound is satisfied without
 * a cast.
 */
function respondAdminMeta(payload: Record<string, unknown>): Response {
  const response = respondData(payload);
  // Configuration, not content: see `SKIP_DATE_FORMATTING_HEADER`.
  response.headers.set(SKIP_DATE_FORMATTING_HEADER, "1");
  return response;
}

/**
 * Mark a response as belonging to one session.
 *
 * A session-gated GET is otherwise an ordinary cacheable response, so a shared
 * proxy may retain one caller's payload and serve it to the next request
 * without the authentication check running again. `Vary: Cookie` states what
 * the response depends on, for any cache that stores it regardless.
 *
 * Applied to the REFUSAL as well as the answer. A cached 401 replayed to a
 * request that does carry a session is the same defect pointing the other way,
 * and it is the direction that looks like a working gate.
 */
/**
 * Methods whose responses are scoped to ONE caller's session, success or
 * failure alike.
 *
 * A recovery point belongs to a person rather than to a document, so both the
 * snapshot and the refusal are caller-specific: a cached 404 replayed to an
 * authorized reader hides their own unsaved work.
 */
const SESSION_PRIVATE_METHODS = new Set([
  "getEntryAutosave",
  "getSingleAutosave",
]);

export function withSessionCacheHeaders(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

/**
 * GET /api/admin-meta
 *
 * Public — no authentication required, because the sign-in screen renders
 * before a session exists.
 *
 * Branding ONLY. What an anonymous caller may read is decided by which half
 * of `buildAdminMeta` is serialized here, rather than by a list of fields to
 * withhold — so a contribution field added later is private by default. A
 * filter would have to be extended by whoever adds it, and plugin authors
 * choose those fields rather than this package.
 */
async function handleAdminMetaRequest(): Promise<Response> {
  const { branding } = await buildAdminMeta();
  return respondAdminMeta(branding);
}

/**
 * GET /api/admin-meta/workspace
 *
 * The admin metadata that describes the installation rather than its
 * appearance: mounted plugins and everything they contribute, the configured
 * locales, the custom sidebar groups, and whether the builder is available.
 *
 * Gated on a SESSION rather than on a permission. Every signed-in role needs
 * its sidebar and its plugin routes to render, so requiring an administrative
 * permission here would leave a read-only editor with an empty navigation
 * rather than a restricted one. What each role may then DO with a contributed
 * page is decided by that page's own `requiredPermission`.
 *
 * Named for the workspace rather than for plugins because it carries three
 * non-plugin fields; naming it after one of its members is how the next
 * addition ends up on the public route by default.
 */
async function handleAdminMetaWorkspaceRequest(
  req: Request
): Promise<Response> {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) {
    return withSessionCacheHeaders(createJsonErrorResponse(auth));
  }

  // After the authentication precondition, never before it. Service
  // initialisation is lazy, so on the first authenticated request of a process
  // booted through `createDynamicHandlers` the container is still empty — and
  // `buildAdminMeta` would then silently skip the persisted sidebar groups and
  // branding overrides and describe the pre-boot plugin configuration instead
  // of the running one.
  await ensureServicesInitialized();

  // Re-derived per request, and HERE rather than inside `buildAdminMeta`. A
  // collection drawn in the Schema Builder exists the moment it is saved, so a
  // set frozen at boot describes an install that has since changed -- and in
  // production "the next restart" means the next deploy.
  //
  // 🔴 Only on this route. `buildAdminMeta` is shared with the PUBLIC branding
  // handler, which deliberately does not initialise services: refreshing there
  // asked an empty container for the collection registry on every anonymous
  // login-page request, logging a registry-unavailable error for a payload that
  // discards `workspace.widgets` anyway -- and, once initialised, made a cheap
  // branding read load every collection's schema from the database.
  await refreshCollectionWidgets();

  // 🔴 The generated cards are resolved HERE rather than inside `buildAdminMeta`,
  // because which of them a reader may be told about depends on the reader.
  // Their id, title and query all name a COLLECTION, so publishing the whole
  // set would disclose the slug and the existence of every collection in the
  // install to any authenticated caller — including the ones the layout and
  // query endpoints deliberately hide from them. That the admin would not draw
  // the card is not a control; the payload is JSON, and reading it is the
  // bypass. The verdicts come from the same implementation the layout endpoint
  // filters with, so the two cannot disagree about what this reader may see.
  const caller = readAccessCaller(await readCaller(auth));
  // The verdict the QUERY path takes. `canReadEntity` evaluates a collection's
  // code-defined `access.read` as well as the stamped grant, and
  // `callerHoldsPermission` does not -- so an API key those rules reject is
  // refused by the query endpoint and would have been told the collection
  // exists by this payload. One question, one answer.
  const readableCollectionSlugs = await readableCollections(
    generatedWidgets().map(generatedCollectionSlug),
    caller
  );
  const readable = readableGeneratedWidgets(
    slug => readableCollectionSlugs.has(slug),
    // Every DECLARED id, registrations included. Filtering only contributions
    // left a registration colliding with a generated card published TWICE in
    // this payload -- once as itself and once as core's derived guess -- and the
    // canonical set resolves that collision in the registration's favour, so the
    // two halves of the response disagreed about which declaration the card is.
    new Set([
      ...contributedWidgets().map(widget => widget.id),
      ...publishableWidgets().map(widget => widget.id),
    ])
  );

  const { workspace } = await buildAdminMeta(readable);
  return withSessionCacheHeaders(respondAdminMeta(workspace));
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

    // respondMutation. The updated groups array is the
    // mutation `item` and the toast message is server-authored.
    return respondMutation("Sidebar groups updated.", updated);
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

// ============================================================================
// CRUD Handler Wrappers
// ============================================================================

async function handleGet(req: Request, params: string[]) {
  // Matched before the bare `admin-meta` branch, which would otherwise answer
  // for every path beneath it and serve the public payload from the
  // authenticated route's URL.
  if (params[0] === "admin-meta" && params[1] === "workspace") {
    return handleAdminMetaWorkspaceRequest(req);
  }
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
    return new Response(stream, {
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
  if (params[0] === "_dev" && process.env.NODE_ENV === "development") {
    return handleDevSchemaRequest(req, params, "POST");
  }
  return handleServiceRequest(req, params, "POST");
}

async function handlePut(req: Request, params: string[]) {
  return handleServiceRequest(req, params, "PUT");
}

async function handlePatch(req: Request, params: string[]) {
  if (params[0] === "admin-meta" && params[1] === "sidebar-groups") {
    return handleAdminMetaSidebarGroups(req);
  }
  return handleServiceRequest(req, params, "PATCH");
}

async function handleDelete(req: Request, params: string[]) {
  if (params[0] === "_dev" && process.env.NODE_ENV === "development") {
    return handleDevSchemaRequest(req, params, "DELETE");
  }
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
 * import { createDynamicHandlers } from 'nextly';
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
    // Before the config is stored, so no request can be served against a
    // plugin whose `clientConfig` cannot be delivered. `resolvePlugins` runs
    // the same check, but service initialisation is lazy and `/api/admin-meta`
    // is served WITHOUT it — so on an admin's first request that check has not
    // happened yet, and the failure would land on the branding response
    // instead of at startup. This module runs when the route file is imported,
    // which is the earliest deterministic point the config exists.
    assertClientConfigs(options.config.plugins ?? []);
    // And the widgets beside it. `/api/admin-meta/workspace` serializes both
    // halves through one `JSON.stringify`, so a widget carrying a bigint takes
    // the whole authenticated workspace payload down for every admin -- a
    // wider failure than a bad `clientConfig`, reached the same way.
    assertAdminWidgets(options.config.plugins ?? []);
    setHandlerConfig(options.config);
  }

  // Enable Next cache-tag revalidation: every content write now busts the tags
  // a read carries (see `nextly/runtime` `nextlyTags` / `cachedFind`). Runs here
  // because this is the app's Next entry point; idempotent and safe to omit for
  // a non-Next runtime (the write path just no-ops the flush).
  registerNextCacheRevalidator();

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
  // The default keyGenerator needs the trust-proxy settings so it
  // can resolve a real client IP rather than blindly trusting
  // X-Forwarded-For. Inject from `security.trustProxy` +
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
    trustedProxyIps: rateLimitConfig?.trustedProxyIps ?? trustedProxyIpsFromEnv,
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

    // Run the handler, then layer on CORS + security headers.
    //
    // Wrapped in a side-effect warning scope because this is the one place
    // every verb converges on, and a post-commit hook failure has to reach the
    // response the client is waiting on. The response builders read the scope
    // from inside it, so nothing between here and them has to carry the
    // failures; a request whose hooks all succeed collects an empty array and
    // its body is unchanged.
    // Captured inside the scope, which closes when this returns. The dynamic
    // routes do not pass through `withErrorHandler`, so without this the
    // detail an envelope flattened on the ordinary `/api/...` surface reaches
    // the log only as the boundary's reconstruction, with neither the cause
    // nor the context the thrower attached.
    let flattenedInRequest: NextlyError[] = [];
    const { result: response } = await withSideEffectWarnings(async () => {
      try {
        return await handler();
      } finally {
        flattenedInRequest = currentFlattenedErrors();
      }
    });
    // Settled BEFORE logging and put on the response, so the id an operator
    // reads in the log is one the caller actually received. The response
    // helpers do not set it for a 200 carrying per-item failures, so without
    // this the log would carry an id generated here and shown to nobody,
    // which is the join the diagnostics exist for.
    const effectiveRequestId =
      response.headers.get("x-request-id") ?? readOrGenerateRequestId(req);
    const identifiedResponse = withRequestIdHeader(
      response,
      effectiveRequestId
    );
    // Imported here rather than at module scope, matching how this file already
    // reaches the logger, so the route entry point keeps its import graph.
    const { getNextlyLogger: resolveLogger } = await import(
      "./observability/logger"
    );
    logFlattenedErrors(
      flattenedInRequest,
      entry => resolveLogger().error(entry),
      {
        requestId: effectiveRequestId,
        route: new URL(req.url).pathname,
        method: req.method,
      }
    );
    const formattedResponse = await applyGlobalDateFormatting(
      identifiedResponse,
      req
    );
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
      // eslint-disable-next-line @typescript-eslint/require-await
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
 * import { getCollectionsHandler } from 'nextly';
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

export const _handleAdminMetaRequestForTest = handleAdminMetaRequest;
export const _handleAdminMetaSidebarGroupsForTest =
  handleAdminMetaSidebarGroups;

/**
 * Populate the reserved `_authenticated*` route params from the authorized
 * user so downstream services get the caller's identity and roles.
 *
 * `parseRestRoute` copies every query-string key into `routeParams`, so these
 * reserved keys are stripped first: they are server-authored and a
 * client-supplied copy (e.g. `?_authenticatedUserRoles=["admin"]`) must never
 * be trusted. Roles are forwarded as SLUGS — session auth carries role IDs on
 * `AuthContext.roles`, so those are resolved; API-key auth already carries
 * key-scoped slugs.
 */
async function setAuthenticatedRouteParams(
  routeParams: Record<string, string> | undefined,
  authorizedUser: AuthContext | undefined,
  // Whether `_authenticatedUserRoles` is consumed downstream, per
  // {@link needsResolvedRoles}. Roles are resolved (a DB query for session auth)
  // only when needed, so routes that never read them don't pay for a
  // permissions lookup.
  needsRoles: boolean
): Promise<void> {
  if (!routeParams) return;

  delete routeParams._authenticatedUserId;
  delete routeParams._authenticatedUserName;
  delete routeParams._authenticatedUserEmail;
  delete routeParams._authenticatedUserRoles;
  delete routeParams._authenticatedActorType;
  delete routeParams._authenticatedActorId;
  delete routeParams._authenticatedPermissions;
  delete routeParams._authenticatedClaims;

  if (!authorizedUser) return;

  routeParams._authenticatedUserId = authorizedUser.userId;
  // The acting identity is resolved here, the only place that knows how the
  // request authenticated: a write attributes to the API key itself when one
  // was used, rather than silently to the user that owns the key.
  const actor = actorFromAuthContext(authorizedUser);
  routeParams._authenticatedActorType = actor.type;
  if (actor.id) routeParams._authenticatedActorId = actor.id;
  if (authorizedUser.userName)
    routeParams._authenticatedUserName = authorizedUser.userName;
  if (authorizedUser.userEmail)
    routeParams._authenticatedUserEmail = authorizedUser.userEmail;
  // The API key's own scoped grants, so a handler deciding access after
  // dispatch judges the key rather than the account that issued it. Empty for
  // session auth, whose grants are resolved from the database instead.
  if (authorizedUser.authMethod === "api-key") {
    routeParams._authenticatedPermissions = JSON.stringify(
      authorizedUser.permissions ?? []
    );
  }
  // Verified extra claims, so a stored `custom` rule decides on the same
  // identity over HTTP that it gets through the Direct API. Server-authored
  // like the keys above: the client-supplied copy was deleted first.
  if (authorizedUser.claims) {
    routeParams._authenticatedClaims = JSON.stringify(authorizedUser.claims);
  }

  if (!needsRoles) return;

  const roleSlugs = await resolveRoleSlugs(authorizedUser);
  routeParams._authenticatedUserRoles = JSON.stringify(roleSlugs ?? []);
}

export const _setAuthenticatedRouteParamsForTest = setAuthenticatedRouteParams;
