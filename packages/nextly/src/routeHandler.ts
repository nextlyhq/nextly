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
  authorizeCaller,
  authorizeCallerForAny,
  requireAuthentication,
  requirePermission,
  requireAllPermissions,
  requireAnyPermission,
  requireCollectionAccess,
  requireCollectionWriteAccess,
  requireLifecycleAccess,
  admittedActionOf,
  createJsonErrorResponse,
  isErrorResponse,
  type AuthContext,
  type ErrorResponse,
  type RefusalTarget,
} from "@nextly/auth/middleware";
import { actorFromAuthContext } from "@nextly/auth/request-actor";
import type { DispatchRequest } from "@nextly/services/dispatcher";

import {
  listApiKeys,
  getApiKeyById,
  createApiKey,
  updateApiKey,
  revokeApiKey,
  getApiKeyAbilities,
} from "./api/api-keys";
import { readAccessCaller, readCaller } from "./api/authenticated-read";
import { handleContentEventsRequest } from "./api/content-events";
import {
  getDashboardOnboarding,
  getDashboardStats,
  getDashboardRecentEntries,
  getDashboardActivity,
} from "./api/dashboard";
import {
  deleteDashboardPin,
  getDashboardPins,
  postDashboardPin,
} from "./api/dashboard-pins";
import {
  acquireLock,
  readLock,
  releaseLock,
  renewLock,
} from "./api/document-lock";
import { buildErrorResponse } from "./api/error-response";
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
import { changeLanguages, getLanguages } from "./api/languages";
import { getNoticeCount, getNotices, markNoticesRead } from "./api/notices";
import {
  listPreviewLinks,
  mintPreviewLink,
  revokePreviewLink,
  revokePreviewLinks,
} from "./api/preview-links";
import { resolveEntryPreviewUrl } from "./api/preview-url";
import { handleReleaseRequest } from "./api/releases";
import { readOrGenerateRequestId, withRequestIdHeader } from "./api/request-id";
// canonical respondX wire shapes (spec §5.1) instead of the
// hand-rolled `{ data: <payload> }` envelope.
import {
  SKIP_DATE_FORMATTING_HEADER,
  withSessionCacheHeaders,
  respondData,
  respondMutation,
} from "./api/response-shapes";
import { getRolesScreen } from "./api/roles-screen";
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
import { getWidgetPreviews } from "./api/widget-previews";
import { postWidgetQuery } from "./api/widget-query";
import { runWithAccessMemo } from "./auth/access/request-memo";
import { apiKeyScopeFrom } from "./auth/authenticated-scope";
import {
  runWithCallerScope,
  runWithRequestCaller,
  type RequestCaller,
} from "./auth/caller-scope";
import { COLLECTION_DEFINITION_PERMISSIONS } from "./auth/collection-definition-policy";
import { readAccessTokenCookie } from "./auth/cookies/access-token-cookie";
import { hasAuthRateLimit } from "./auth/handlers/router";
import { LIST_READ_GATES, requireListRead } from "./auth/list-read-gates";
import type { SanitizedNextlyConfig } from "./collections/config/define-config";
import { container } from "./di/container";
import { readServiceConfig } from "./dispatcher/dispatcher";
import {
  roleChangeCallerFor,
  runAsRoleChangeCaller,
} from "./domains/auth/services/role-change-caller";
import {
  SCHEMA_CHANGE_PERMISSIONS,
  SYSTEM_READ_POLICY,
  SYSTEM_WRITE_POLICY,
  type RouteGrant,
} from "./domains/auth/system-write-policy";
import {
  appLocalization,
  withCurrentLanguages,
} from "./domains/i18n/configured-locales";
import { hasLifecycle } from "./domains/versions/recorded-status";
import { collectionDefaultForReader } from "./domains/widgets/collection-cards";
import type { WidgetAction } from "./domains/widgets/definition";
import { visibilityToken } from "./domains/widgets/layout";
import {
  publishableContentSources,
  publishableWidgets,
} from "./domains/widgets/publish";
import {
  widgetAudience,
  type WidgetAudience,
} from "./domains/widgets/visibility";
import { genericPublicMessage } from "./errors/error-codes";
import { NextlyError } from "./errors/nextly-error";
import { retryAfterHeader } from "./errors/retry-after";
import {
  currentFlattenedErrors,
  logFlattenedErrors,
  withSideEffectWarnings,
} from "./hooks/side-effect-warnings";
import { awaitBootSeeding } from "./init/seed-permissions";
import {
  SKIP_TIMEZONE_FORMAT_HEADER,
  withTimezoneFormatting,
} from "./lib/date-formatting";
import { writeGateFor } from "./lib/immutable-system-fields";
import { createCorsMiddleware } from "./middleware/cors";
import { defaultRestCallerReaders } from "./middleware/rest-callers";
import {
  currentRestLimitGate,
  openRestLimitGate,
  runWithRestLimitGate,
  type RestLimitTarget,
} from "./middleware/rest-limit-gate";
import { createRestLimits, restLimitCounts } from "./middleware/rest-limits";
import { createSecurityHeadersMiddleware } from "./middleware/security-headers";
import type { PluginAdminWidget } from "./plugins/admin-contributions";
import {
  buildPluginAdminMeta,
  type PluginAdminMeta,
} from "./plugins/admin-meta";
import {
  pluginRouteAuthRequired,
  restLimitTargetOf,
  runPluginRoute,
} from "./plugins/routes/dispatch";
import { getPluginRouteRegistry } from "./plugins/routes/route-registry";
import type { PluginRouteMount } from "./plugins/routes/route-types";
import {
  declaredPluginRoute,
  pluginRouteBootDecision,
} from "./plugins/routes/should-register";
import { settingsWritePermission } from "./plugins/settings-permission";
import { assertAdminWidgets } from "./plugins/validate-admin-widgets";
import { assertClientConfigs } from "./plugins/validate-client-config";
import { assertDocumentViews } from "./plugins/validate-document-views";
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
import { resolveRoleSlugs } from "./services/lib/permissions";
import {
  builderDisabledError,
  isBuilderEnabled,
  isBuilderRoute,
} from "./shared/builder-access";
import { consoleLogger } from "./shared/types";
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

/**
 * The response without the control headers a handler used to talk to this
 * boundary.
 *
 * Both markers, unconditionally, and a new response only when one is present so
 * an ordinary reply is not rebuilt for nothing.
 *
 * 🔴 The DECISION they carry has to be read before this runs. Stripping first
 * and asking afterwards silently turns every opt-out back on, which is the
 * failure this helper most invites.
 */
function withoutInternalMarkers(response: Response): Response {
  const marked =
    response.headers.has(SKIP_DATE_FORMATTING_HEADER) ||
    response.headers.has(SKIP_TIMEZONE_FORMAT_HEADER);
  if (!marked) return response;
  const headers = new Headers(response.headers);
  headers.delete(SKIP_DATE_FORMATTING_HEADER);
  headers.delete(SKIP_TIMEZONE_FORMAT_HEADER);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function applyGlobalDateFormatting(
  response: Response,
  req?: Request
): Promise<Response> {
  // READ the markers, then remove them, then act on what they said.
  //
  // Removed before the content-type check rather than after, because that check
  // returns early and `withTimezoneFormatting` — the only other place either
  // marker comes off — is downstream of it. A plugin answering with CSV or XML,
  // which an export or a sitemap route does, therefore carried an internal
  // control header all the way to the client.
  //
  // Marked by the handler rather than matched by path: a plugin may mount its
  // own route ending in the same segment, and it should keep the formatting
  // every other plugin response gets.
  const optedOut =
    response.headers.has(SKIP_DATE_FORMATTING_HEADER) ||
    response.headers.get(SKIP_TIMEZONE_FORMAT_HEADER) === "1";
  const clean = withoutInternalMarkers(response);

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return clean;
  }

  if (optedOut) {
    return clean;
  }

  // Skip formatting for auth endpoints to avoid interfering with auth flow
  if (req) {
    const url = new URL(req.url);
    if (url.pathname.includes("/auth/")) {
      return clean;
    }
  }

  return withTimezoneFormatting(clean);
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
    case "getApiKeyAbilities":
      return getApiKeyAbilities(req);
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
  "notices",
  "jobs",
  "generalSettings",
  "languages",
  "previewLinks",
  "previewUrl",
  "imageSizes",
  "dashboard",
  "documentLock",
  "translations",
  "schema",
  "contentEvents",
  "rolesScreen",
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

/** Delegate a languages request to its handler, which manages its own auth and body. */
async function handleLanguagesRequest(
  req: Request,
  httpMethod: string
): Promise<Response> {
  switch (httpMethod) {
    case "GET":
      return getLanguages(req);
    case "POST":
      return changeLanguages(req);
    default:
      return methodNotAllowed(req, ["GET", "POST"]);
  }
}

/**
 * The canonical refusal for a verb a route does not serve, with the `Allow` header HTTP requires.
 *
 * Built and RETURNED rather than thrown, for the reason the builder gate is: this runs outside
 * the dispatcher's NextlyError-to-response mapping, so a throw would surface as a 500. Serialized
 * by the same `buildErrorResponse` every error boundary uses, so the body carries the code, the
 * sentence and the request id Nextly's own error parser reads.
 */
function methodNotAllowed(req: Request, allowed: readonly string[]): Response {
  const response = buildErrorResponse(
    new NextlyError({
      code: "METHOD_NOT_ALLOWED",
      publicMessage: genericPublicMessage("METHOD_NOT_ALLOWED"),
    }),
    { requestId: readOrGenerateRequestId(req) }
  );
  response.headers.set("allow", allowed.join(", "));
  return response;
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
 * Dashboard handlers manage their own auth (requireAuthentication) and read
 * their own bodies (the layout's and a pin's). Intercepting here — before
 * req.text() — keeps the pattern consistent with API keys and general settings.
 */
async function handleDashboardRequest(
  req: Request,
  method: string
): Promise<Response> {
  switch (method) {
    case "getDashboardStats":
      return getDashboardStats(req);
    case "getDashboardOnboarding":
      return getDashboardOnboarding(req);
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
    case "getDashboardPins":
      return getDashboardPins(req);
    case "postDashboardPin":
      return postDashboardPin(req);
    case "deleteDashboardPin":
      return deleteDashboardPin(req);
    default:
      return new Response(
        JSON.stringify({ error: "Unknown dashboard operation" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
  }
}

/**
 * Delegate a document-lock request to its handler.
 *
 * Advisory locking: every one of these reports a claim and none of them refuses
 * a write, so nothing on the mutation path consults this.
 */
async function handleDocumentLockRequest(
  req: Request,
  method: string
): Promise<Response> {
  switch (method) {
    case "readDocumentLock":
      return readLock(req);
    case "acquireDocumentLock":
      return acquireLock(req);
    case "renewDocumentLock":
      return renewLock(req);
    case "releaseDocumentLock":
      return releaseLock(req);
    default:
      // Reached only if the parser and this switch disagree, which is a new or
      // mistyped route rather than anything the caller did. A canonical error
      // carries the code and request id a client needs to report it; an ad hoc
      // `{ error }` body is unreadable exactly when someone is debugging.
      throw NextlyError.notFound({
        logContext: { service: "documentLock", method },
      });
  }
}

// ============================================================================
// Notices Direct Dispatch
// ============================================================================

/** The signed-in person's notices. */
async function handleNoticesRequest(
  req: Request,
  method: string
): Promise<Response> {
  switch (method) {
    case "getNotices":
      return getNotices(req);
    case "getNoticeCount":
      return getNoticeCount(req);
    case "markNoticesRead":
      return markNoticesRead(req);
    default:
      // Thrown, not answered by hand, so the shared handler supplies the
      // canonical envelope, request id and status, as for the jobs routes.
      throw NextlyError.notFound({
        message: `Unknown notices operation: ${method}`,
        logContext: { reason: "unknown-notices-operation", method },
      });
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
// Authorization Helpers
// ============================================================================

/**
 * Collection entry methods that operate on collection data (not definitions).
 *
 * Membership decides which permission a method resolves to, and the fallthrough
 * is not a refusal: a method absent from this set lands on the definition branch
 * and demands every schema change permission. That denies the editors who hold
 * `update-{slug}` and grants the request to a caller who holds settings but no
 * access to the collection, so an omission fails in both directions at once.
 * Exported so the route-parser suite can assert every entry route's method
 * against it rather than restating the list.
 */
/**
 * The collection entry methods whose dispatcher handler reads through the
 * query service's filtered read: a list, a count and a read by id, which
 * answers an entry outside a read rule's filter as missing.
 */
const FILTERED_READ_METHODS: ReadonlySet<string> = new Set([
  "listEntries",
  "countEntries",
  "getEntry",
]);

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
  // The entry's content events, guarded the same way.
  "listEntryEvents",
  "getEntryVersion",
  "getEntryVersionDiff",
  // Restoring writes the document, so the route parser marks it an `update`
  // operation and this resolves to the `update-{slug}` permission.
  "restoreEntryVersion",
  // Naming a version writes history rather than the document, but it is still
  // a write and resolves to the same permission.
  "setEntryVersionLabel",
  // Marking a version seen changes only the caller's own marker; the route
  // parser marks it a `read`, so it resolves to `read-{slug}`.
  "markEntryVersionSeen",
  // Discarding the working draft reverts the document to its live row; the
  // route parser marks it an `update` operation, so it resolves to the
  // `update-{slug}` permission rather than a definition mutation's settings grants.
  "discardWorkingDraft",
  // Taking the live shared values rewrites the pending change, as a discard
  // does, so it is authorized as an update of the entry too.
  "takeLiveSharedValues",
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
  // The document's content events, guarded the same way.
  "listSingleEvents",
  "getSingleVersion",
  "getSingleVersionDiff",
  // A write, authorized as an update of the document.
  "restoreSingleVersion",
  // Changes only the caller's own marker, so it is named in the read branch
  // below and resolves to `read`.
  "markSingleVersionSeen",
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
  // definition mutation's settings grants. The service checks `publish-{slug}`
  // on top, which no route-level gate can express.
  "publishAllSingleLocales",
  // Discarding the working draft reverts the document to its live row. Left out
  // of the read branch below so it resolves to `update-{slug}`: a caller who may
  // not update the document may not throw away its pending edits either.
  "discardSingleWorkingDraft",
  // Taking the live shared values rewrites the pending change: an update too.
  "takeLiveSingleSharedValues",
]);

/**
 * Read methods that still need resolved role slugs, even though reads normally
 * skip the lookup.
 *
 * Every method here runs the caller through `checkCollectionAccess`, whose
 * RBAC gate matches the caller's permissions against the roles forwarded in
 * the request context. A caller arriving without roles is therefore treated
 * as holding no roles, so a role-based rule denies a legitimately permitted
 * reader. Super-admin authority is not among them: the gate looks it up.
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
  // The autosave reads run through the same gate the version reads use, so
  // they need resolved roles for the same reason: without them a caller arrives
  // holding no roles, and the gate answers not-found for the author whose own
  // recovery point it is.
  "getEntryAutosave",
  "getSingleAutosave",
  // Marking a version seen runs the same document gate as reading it.
  "markEntryVersionSeen",
  "markSingleVersionSeen",
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
  // A document's events run the same document gate, which reads roles.
  "listEntryEvents",
  "listSingleEvents",
]);

/**
 * Decide whether a request needs its role slugs resolved before dispatch.
 *
 * Resolving roles costs a permissions query for session auth, so it is opt-in:
 * collection and single mutations consume them for hook context and access
 * rules, and the reads in {@link ROLE_AWARE_READ_METHODS} consume them to run
 * the access gate. Every other route reads no roles and must not pay for
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
 * The response boundary, reachable without booting a route.
 *
 * What it decides — which markers come off, and whether the body is rewritten —
 * is worth holding still, and the only other way to observe it is a full
 * request through the dynamic handlers.
 */
export const _applyGlobalDateFormattingForTest = applyGlobalDateFormatting;

/**
 * What a refused read of permissions names, whichever of the grants it
 * accepts the caller lacked.
 */
const READING_PERMISSIONS: RefusalTarget = LIST_READ_GATES.permissions.names;

/**
 * Centralized permission resolver for all API service endpoints.
 *
 * Determines the correct permission check for each service/method combination
 * and delegates to the appropriate middleware function.
 *
 * @returns Auth result — either `{ user }` on success or `ErrorResponse` on failure.
 */
/**
 * The write routes a caller may reach on update, or on publish or unpublish
 * alone ({@link requireCollectionWriteAccess}): the service judges a write
 * that changes only the status by that gate, and any other by update.
 */
const STATUS_WRITE_METHODS: ReadonlySet<string> = new Set([
  "updateEntry",
  "bulkUpdateEntries",
  "bulkUpdateByQuery",
  "updateSingleDocument",
]);

/**
 * The action a status write route's request asks, read only once every
 * action has refused it, so the refusal names that action: the gate the
 * services judge the write by ({@link writeGateFor}). A bulk route carries
 * the write as its body's `data`. The body is read from a copy, and a body or
 * lookup that cannot be read is answered as update, since only the refusal's
 * words depend on it.
 */
function actionAskedBy(
  req: Request,
  method: string,
  entity: "collection" | "single",
  slug: string
): () => Promise<"update" | "publish" | "unpublish"> {
  return async () => {
    try {
      const body: unknown = JSON.parse(await req.clone().text());
      const write =
        method === "bulkUpdateEntries" || method === "bulkUpdateByQuery"
          ? (body as { data?: unknown } | null)?.data
          : body;
      if (typeof write !== "object" || write === null || Array.isArray(write)) {
        return "update";
      }
      // The entity's lifecycle, from the record the services read it from.
      const lifecycle = async () =>
        hasLifecycle(
          entity === "single"
            ? await container
                .get<{
                  getSingleBySlug(slug: string): Promise<unknown>;
                }>("singleRegistryService")
                .getSingleBySlug(slug)
            : await container
                .get<{
                  getCollectionBySlug(slug: string): Promise<unknown>;
                }>("collectionRegistryService")
                .getCollectionBySlug(slug)
        );
      return await writeGateFor(
        write as Record<string, unknown>,
        entity,
        lifecycle
      );
    } catch {
      return "update";
    }
  };
}

/**
 * The routes that change only the status of every language, each admitted on
 * its own action's grant rather than update; the service asks that action's
 * rule in each language the change puts live.
 */
const LIFECYCLE_ROUTE_ACTIONS: Readonly<
  Record<string, "publish" | "unpublish">
> = {
  publishAllLocales: "publish",
  unpublishAllLocales: "unpublish",
  publishAllSingleLocales: "publish",
};

/**
 * The collection entry and Single document methods a visitor, a request
 * carrying no credential, may reach: reading, counting and the plain writes of
 * one entry or document, judged by the Public role. A version, an event, an
 * autosave, a bulk write and every lifecycle route still need a signed-in
 * caller: a visitor reads published content only and never publishes.
 */
const VISITOR_METHODS: ReadonlySet<string> = new Set([
  "listEntries",
  "countEntries",
  "getEntry",
  "createEntry",
  "updateEntry",
  "deleteEntry",
  "getSingleDocument",
  "updateSingleDocument",
]);

/** Whether a route serves a visitor: an entry or document method it admits one at. */
function servesVisitor(service: string, method: string): boolean {
  return VISITOR_SERVICES.has(service) && VISITOR_METHODS.has(method);
}

/** The services whose entry and document routes serve a visitor. */
const VISITOR_SERVICES: ReadonlySet<string> = new Set([
  "collections",
  "singles",
]);

/**
 * Whether a request carries no credential at all, read without the container:
 * a header read and a cookie parse.
 */
function carriesNoCredential(req: Request): boolean {
  return (
    req.headers.get("authorization") === null &&
    readAccessTokenCookie(req) === null
  );
}

async function resolveAuthorization(
  req: Request,
  service: string,
  method: string,
  operation: string,
  routeParams: Record<string, string> | undefined,
  httpMethod: string,
  // Whether the request's path names one entry; see the caller.
  entryInPath = false
): Promise<AuthContext | ErrorResponse | null> {
  // --- Collection endpoints ---
  if (service === "collections") {
    if (COLLECTION_ENTRY_METHODS.has(method)) {
      // Entry operations → {action}-{collectionSlug}
      const slug = routeParams?.collectionName || "";
      const route = {
        method,
        params: routeParams ?? {},
        namesOne: entryInPath,
        // A list, a count and a read by id read through the query service's
        // filtered read, which applies a read rule's filter; every other entry
        // route refuses a caller whose rule answers one.
        appliesReadFilter: FILTERED_READ_METHODS.has(method),
        admitsVisitor: VISITOR_METHODS.has(method),
      };
      if (STATUS_WRITE_METHODS.has(method)) {
        return requireCollectionWriteAccess(
          req,
          slug,
          route,
          actionAskedBy(req, method, "collection", slug)
        );
      }
      const lifecycle = LIFECYCLE_ROUTE_ACTIONS[method];
      if (lifecycle) {
        return requireLifecycleAccess(req, lifecycle, slug, route);
      }
      return requireCollectionAccess(
        req,
        getActionFromOperation(operation),
        slug,
        route
      );
    }
    if (method === "getCollection") {
      const slug = routeParams?.collectionName || "";
      return requireCollectionAccess(req, "read", slug, {
        method,
        params: routeParams ?? {},
      });
    }
    // Definition mutations (create/update/delete collection). The grant is
    // declared once, in `auth/collection-definition-policy`, because the
    // onboarding checklist asks the same question to decide whether to OFFER
    // the step -- and a copy there would go on asking for a grant this route
    // had stopped requiring.
    return requireAllPermissions(req, COLLECTION_DEFINITION_PERMISSIONS);
  }

  // --- Singles endpoints ---
  if (service === "singles") {
    if (SINGLE_DOCUMENT_METHODS.has(method)) {
      // Document operations → {action}-{singleSlug}. The read-only methods
      // must not demand update permission just by sharing this set.
      const action =
        method === "getSingleDocument" ||
        method === "listSingleVersions" ||
        method === "listSingleEvents" ||
        method === "getSingleVersion" ||
        method === "getSingleVersionDiff" ||
        method === "getSingleAutosave" ||
        method === "markSingleVersionSeen"
          ? "read"
          : "update";
      const slug = routeParams?.slug || "";
      const route = {
        method,
        params: routeParams ?? {},
        // A Single is its one document, named by its slug.
        namesOne: true,
        admitsVisitor: VISITOR_METHODS.has(method),
      };
      if (STATUS_WRITE_METHODS.has(method)) {
        return requireCollectionWriteAccess(
          req,
          slug,
          route,
          actionAskedBy(req, method, "single", slug)
        );
      }
      const lifecycle = LIFECYCLE_ROUTE_ACTIONS[method];
      if (lifecycle) {
        return requireLifecycleAccess(req, lifecycle, slug, route);
      }
      return requireCollectionAccess(req, action, slug, route);
    }
    if (method === "getSingleSchema") {
      const slug = routeParams?.slug || "";
      return requireCollectionAccess(req, "read", slug, {
        method,
        params: routeParams ?? {},
      });
    }
    // Definition mutations (create/delete single, update schema) are schema
    // changes: create, update and delete on settings, all three.
    return requireAllPermissions(req, SCHEMA_CHANGE_PERMISSIONS);
  }

  // --- Plugin settings → the SETTINGS permissions ---
  //
  // Without this branch these routes fell through to the default mapping,
  // which asks for `read-pluginSettings` / `update-pluginSettings`. Neither is
  // seeded — settings are granted by their plain permissions on `settings` —
  // so every settings administrator got a 403 and only the super-admin bypass
  // could use the API at all.
  if (service === "pluginSettings") {
    // A plugin may name its own permission for its settings in place of
    // `update-settings` (`contributes.settingsPermission`), checked at boot to
    // be one it declares.
    //
    // Services are booted before the declaration is read, as the dispatch
    // after this gate boots them anyway. On a cold process neither config
    // answered for the boot: the registered one did not exist yet, and the
    // handler's still held the plugins as declared, before a `setup`
    // transformer could change one's `settingsPermission`. Either way the
    // first request was judged against a permission the dispatch would not
    // serve under. Booted, the registered config is the plugin list the
    // dispatch reads; the handler's config stays the fallback for a process
    // that registered without one.
    //
    // The caller is authenticated first. A request this gate refuses for want
    // of a session or key must not make the process boot, run its startup
    // migrations or start plugins, which is why the dispatch path keeps
    // authorization ahead of boot too. Authentication boots only for a session
    // token whose signature verified, to read whether its account may still
    // use it; anything else is refused without a booted service.
    //
    // The permission is judged on that same caller rather than by
    // authenticating the request again: each authentication of an API key
    // spends a slot of its rate limit, so a second one counted every settings
    // request twice and refused a key with one request left.
    //
    // So the caller is read once the grants it carries are settled. A boot
    // already in flight may still be seeding the plugin's permission and
    // granting it as it goes, and a key's grants read before it finished lack
    // what the boot gave them. This waits only for a boot another request
    // started, and never starts one itself.
    await awaitBootSeeding();
    const caller = await requireAuthentication(req);
    if (isErrorResponse(caller)) return caller;
    await ensureServicesInitialized();
    const write = settingsWritePermission(
      readServiceConfig()?.plugins ?? getHandlerConfig()?.plugins,
      routeParams?.plugin
    );
    if (httpMethod === "GET") {
      // Whoever may change the settings may also read them: a grant of the
      // plugin's permission alone would otherwise open a page that cannot load.
      return authorizeCallerForAny(caller, [
        ...SYSTEM_READ_POLICY.settings.read.anyOf,
        write,
      ]);
    }
    // A write to a plugin's configuration is a settings change, so it takes
    // the same permission a settings change takes anywhere else, unless the
    // plugin named its own: then that one alone, so a settings role does not
    // reach settings the plugin kept to a narrower role.
    return authorizeCaller(caller, write.action, write.resource);
  }

  // --- Email providers → their own action on email-providers ---
  if (service === "emailProviders") {
    // The provider catalog is the one read a CREATOR also needs. The
    // permissions are seeded independently, so a role holding only
    // create-email-providers can POST a provider and would otherwise be denied
    // the descriptors describing which fields that provider requires --
    // leaving the grant unusable for exactly the contributed providers the
    // catalog exists to describe. It exposes definitions, never stored records.
    return requireListRead(
      req,
      emailGrant("emailProviders", method, httpMethod)
    );
  }

  // --- Email templates → their own action on email-templates ---
  if (service === "emailTemplates") {
    return requireListRead(
      req,
      emailGrant("emailTemplates", method, httpMethod)
    );
  }

  // --- User fields → their own action on settings ---
  if (service === "userFields") {
    const action = getActionFromMethod(httpMethod);
    return requireAnyPermission(req, [{ action, resource: "settings" }]);
  }

  // --- Field groups → their own action on settings ---
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
    return requireAnyPermission(req, [{ action, resource: "settings" }]);
  }

  // --- RBAC: roles and permissions ---
  if (service === "rbac") {
    // listRolePermissions: allow read-roles or read-permissions
    // (role edit form needs this to populate the PermissionMatrix)
    if (method === "listRolePermissions") {
      return requireAnyPermission(
        req,
        [
          { action: "read", resource: "roles" },
          { action: "read", resource: "permissions" },
        ],
        READING_PERMISSIONS
      );
    }

    // The permissions and roles lists: the gates the dashboard's counts of
    // them read too.
    if (method === "listPermissions") {
      return requireListRead(req, LIST_READ_GATES.permissions);
    }
    if (method === "listRoles") {
      return requireListRead(req, LIST_READ_GATES.roles);
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
      return requireAnyPermission(
        req,
        [
          { action: "read", resource: "roles" },
          { action: "read", resource: "permissions" },
        ],
        READING_PERMISSIONS
      );
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

  // The users list: the gate the dashboard's user count reads too.
  if (service === "users" && method === "listUsers") {
    return requireListRead(req, LIST_READ_GATES.users);
  }

  // --- Default: {action}-{service} (e.g., read-users, create-users) ---
  const action = getActionFromMethod(httpMethod);
  return requirePermission(req, action, service);
}

/**
 * The permission gate, reachable without a session or a database: what it
 * asks of a caller is the decision under test, and the checks it delegates
 * to are covered where they are defined.
 */
export const _resolveAuthorizationForTest = resolveAuthorization;

// ============================================================================
// Service Request Handler
// ============================================================================

/**
 * Handle service requests with authentication and authorization
 */
/**
 * One mount's pass: the answer a plugin route gives this request, or `null`
 * when none of that mount's routes claims it.
 *
 * Plugin routes are registered during service initialisation, and that is lazy:
 * an app wired through `createDynamicHandlers({ config })` has an empty registry
 * on its first request. A public plugin route would answer 400 until something
 * else happened to boot the app, and on a serverless worker that repeats for
 * every cold start.
 *
 * Gated on the config actually declaring a matching route, so an app with none
 * never boots on an unknown path. That is what the initialisation further down
 * is careful about: booting for traffic that is about to be refused hands an
 * unauthenticated caller a cold start it could not otherwise cause. An app that
 * DOES contribute a matching route has to boot to serve it, and a public one has
 * to boot for an unauthenticated caller by definition.
 *
 * Called once per mount, at the point that mount is consulted, so the decision
 * to boot is never made on behalf of a pass whose turn has not come.
 *
 * A matching route always goes through `ensureServicesInitialized`, warm or
 * cold. Whether boot has FINISHED is that function's own question, and it holds
 * the single-flight latch and the migration gate that answer it; a cheaper
 * check here read the route registry, which `initializePlugins` fills long
 * before the rest of registration completes, so a second request arriving in
 * that window ran its handler against a half-built runtime. On a booted process
 * the call settles an already-resolved latch.
 */
async function reachPluginRoute(
  req: Request,
  httpMethod: string,
  requestPath: string,
  mount: PluginRouteMount
): Promise<Response | null> {
  const decision = pluginRouteBootDecision(
    getHandlerConfig()?.plugins,
    {
      method: httpMethod,
      path: requestPath,
      // Both reads are free of the container: a header read and a cookie parse.
      // A request carrying neither is refused by the route's own auth without
      // resolving a service, so booting for it would be work nobody asked for.
      hasCredential:
        req.headers.get("authorization") !== null ||
        readAccessTokenCookie(req) !== null,
    },
    mount
  );

  if (decision.kind === "authRequired") {
    const refused = await currentRestLimitGate()?.settle(
      restLimitTargetOf(decision.route)
    );
    return refused ?? pluginRouteAuthRequired(req, decision.route);
  }
  if (decision.kind === "boot") {
    const refused = await limitBeforeBoot(httpMethod, requestPath, mount);
    if (refused) return refused;
    await ensureServicesInitialized();
  }

  const match = getPluginRouteRegistry().match(httpMethod, requestPath, mount);
  return match === null ? null : runPluginRoute(req, match);
}

/**
 * The REST limit for a request about to boot the app for a plugin route,
 * judged from the route's declaration so an over-budget request costs no
 * boot. A route asking for a person is only checked against its plugin's
 * spent failed-resolution bound here; its limit is settled around the
 * person's resolution, which needs the booted app. A route only boot can
 * name, behind a `setup` transformer, is judged once it is booted.
 */
async function limitBeforeBoot(
  method: string,
  path: string,
  mount: PluginRouteMount
): Promise<Response | null> {
  const gate = currentRestLimitGate();
  if (!gate) return null;
  const declared = declaredPluginRoute(
    getHandlerConfig()?.plugins,
    { method, path },
    mount
  );
  if (declared === null) return null;
  return declared.route.principal === undefined
    ? gate.settle(restLimitTargetOf(declared.route))
    : gate.personBoundRefusal(declared.pluginName);
}

/**
 * Whether a plugin route could take this request: the boot decision's own
 * question, asked of both mounts as if a credential were present, and the
 * registry's match. Neither needs a boot or the container.
 *
 * When none could, the REST limit is decided before routing. When one could,
 * the limit waits for the route, which may count the request by a plugin's
 * kind of person or keep it out of the unresolved sources' ceiling.
 */
function mayReachPluginRoute(method: string, params: string[]): boolean {
  const request = {
    method,
    path: "/" + params.join("/"),
    hasCredential: true,
  };
  const plugins = getHandlerConfig()?.plugins;
  // The registry as well as the declarations: an app booted elsewhere, whose
  // handler was created without a config, has routes only the registry knows.
  return (["plugin", "root"] as const).some(
    mount =>
      pluginRouteBootDecision(plugins, request, mount).kind !== "skip" ||
      getPluginRouteRegistry().match(method, request.path, mount) !== null
  );
}

/**
 * Serve a request the built-in router answers, after the REST limit for it.
 * A limit already decided answers nothing here, so a request is counted once.
 */
async function withinBuiltInLimit(
  serve: () => Promise<Response>
): Promise<Response> {
  const refused = await currentRestLimitGate()?.settle("core");
  return refused ?? serve();
}

/** Serves one REST request with one language list from start to end (`withCurrentLanguages`). */
function handleServiceRequest(
  req: Request,
  params: string[],
  httpMethod: string
): Promise<Response> {
  return withCurrentLanguages(() =>
    serveServiceRequest(req, params, httpMethod)
  );
}

async function serveServiceRequest(
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
  const requestPath = "/" + params.join("/");
  const namespacedAnswer = await reachPluginRoute(
    req,
    httpMethod,
    requestPath,
    "plugin"
  );
  if (namespacedAnswer) return namespacedAnswer;

  const { service, operation, method, routeParams } = parseRestRoute(
    params,
    httpMethod,
    searchParams
  );
  // Whether the PATH names one entry. The parsed parameters also carry the
  // query, so a list request with `?entryId=` would otherwise read as naming
  // one; parsed without its query, only a route that names one has an id.
  const entryInPath =
    parseRestRoute(params, httpMethod).routeParams?.entryId !== undefined;

  if (!service || !operation || !method) {
    // Only now. A plugin may claim a top-level path, and this is the point at
    // which the built-in router has said it serves nothing there. Asking
    // earlier would let a plugin answer for `/collections` or `/auth` by
    // declaring the path first, so the ordering IS the guard: there is no list
    // of reserved prefixes to keep in step with the routes core adds later,
    // because core's own answer always comes first.
    // Root routes are consulted for boot HERE too, not alongside the namespaced
    // pass above. Asked earlier, a plugin declaring `/collections/:id` would run
    // database and plugin startup for every anonymous request to core's own
    // `/collections` -- a path it never gets to answer, since this branch is
    // reached only once the built-in router has said it serves nothing.
    const rootAnswer = await reachPluginRoute(
      req,
      httpMethod,
      requestPath,
      "root"
    );
    if (rootAnswer) return rootAnswer;

    return withinBuiltInLimit(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error:
              "Invalid REST route format. Check supported endpoints: /api/users, /api/roles, /api/permissions",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );
  }

  // The built-in router serves this request: its REST limit, before any work.
  const refusedBuiltIn = await currentRestLimitGate()?.settle("core");
  if (refusedBuiltIn) return refusedBuiltIn;

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

  // ==================== CONTENT EVENTS BY SUBJECT ====================
  // A subject's events read by subject (a release's, or a deleted
  // document's). The handler owns its authorization.
  if (service === "contentEvents") {
    return handleContentEventsRequest(req);
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
    // Named per method, with minting the one an unrecognised name would NOT
    // fall into by accident: each is matched exactly, and anything else is
    // not found.
    if (method === "listPreviewLinks") return listPreviewLinks(req);
    if (method === "revokePreviewLink") {
      return revokePreviewLink(req, routeParams ?? {});
    }
    if (method === "revokePreviewLinks") return revokePreviewLinks(req);
    if (method === "mintPreviewLink") return mintPreviewLink(req);
    throw NextlyError.notFound({
      message: `Unknown preview-links operation: ${method}`,
      logContext: { service: "previewLinks", method },
    });
  }

  // ==================== PREVIEW URL DIRECT DISPATCH ====================
  // Beside the handlers above and for the same reason: it parses its own JSON,
  // and the shared body read below would leave the stream empty.
  if (service === "previewUrl") {
    return resolveEntryPreviewUrl(req);
  }

  // ==================== LANGUAGES DIRECT DISPATCH ====================
  if (service === "languages") {
    return handleLanguagesRequest(req, httpMethod);
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

  // ==================== DOCUMENT LOCK DIRECT DISPATCH ====================
  // Owns its auth (requireAuthentication) and reads its own body, so it
  // intercepts here for the same reason dashboard does: before `req.text()`,
  // which the read has no body for.
  if (service === "documentLock") {
    return handleDocumentLockRequest(req, method);
  }

  // ==================== TRANSLATIONS DIRECT DISPATCH ====================
  // Owns its auth (requireAuthentication) and is read-only, so it intercepts
  // here for the same reason dashboard does: before `req.text()`, which a GET
  // has no body for.
  if (service === "translations") {
    return handleTranslationsRequest(req, method);
  }

  // ==================== NOTICES DIRECT DISPATCH ====================
  // Owns its auth (requireAuthentication, refusing API keys) and reads its own
  // body, so it intercepts before `req.text()` for the reason dashboard does.
  if (service === "notices") {
    return handleNoticesRequest(req, method);
  }

  // ==================== SCHEMA DIRECT DISPATCH (F10 PR 4) ====================
  // Schema-journal handler owns its auth (requireAuthentication +
  // super-admin gate). Read-only GET — no body to consume.
  if (service === "schema") {
    return handleSchemaRequest(req, method);
  }

  // ==================== ROLES SCREEN DIRECT DISPATCH ====================
  // Owns its auth (the `read-roles` permission the roles list asks). Read-only
  // GET, so there is no body to consume.
  if (service === "rolesScreen") {
    return getRolesScreen(req);
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
        return refuseRequest(req, method, authResult);
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
        return refuseRequest(req, method, authResult);
      }
      authorizedUser = authResult;
    }
    // Require specific permission based on service/method/operation
    else {
      // A request carrying no credential to a route that serves visitors is
      // judged by the Public role, which is read through the app's services,
      // so they are initialised before it is judged, as `getDispatcher()`
      // would only do after. A route that serves no visitor still refuses
      // such a request before anything boots.
      if (servesVisitor(service, method) && carriesNoCredential(req)) {
        await ensureServicesInitialized();
      }
      const authResult = await resolveAuthorization(
        req,
        service,
        method,
        operation,
        routeParams,
        httpMethod,
        entryInPath
      );
      if (isErrorResponse(authResult)) {
        return refuseRequest(req, method, authResult);
      }
      // `null` is a visitor the gate admitted: dispatched with no caller, so
      // the service judges it as the visitor it is.
      authorizedUser = authResult ?? undefined;
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

  // Who may give super-admin authority, and removing the last active
  // super-admin, are both decided by the role and user services themselves,
  // so they hold for every path. The caller they judge is pinned around the
  // dispatch below.

  // ==================== DISPATCH REQUEST ====================
  // The caller travels in request context, never in route params, which a
  // query string also fills. Handlers read it to pass the user into service
  // calls and hook contexts; without it activity-log hooks have no user.
  stripReservedIdentityParams(routeParams);
  const caller = await requestCallerFor(
    authorizedUser,
    needsResolvedRoles(service, method, httpMethod)
  );

  const dispatchRequest: DispatchRequest = {
    service,
    operation,
    method,
    params: routeParams,
    body,
    request: req, // Pass request for accessing headers (IP, user-agent, etc.)
  };

  const dispatcher = await getDispatcher();
  // The key's own scope is pinned for the whole dispatch rather than serialized
  // into route params beside it. The params carry strings, so the scope written
  // there was a lossy copy: it held the stored permission slugs and neither the
  // caller's roles nor the permission rows a rule's list is built from, and
  // every gate underneath that read it judged the key on a scope
  // missing most of itself. Pinning hands the same object to all of them, and a
  // field added to the scope later reaches them without a second edit here.
  const result = await runWithCallerScope(
    authorizedUser?.authMethod === "api-key"
      ? apiKeyScopeFrom(authorizedUser)
      : undefined,
    () =>
      runWithRequestCaller(caller, () =>
        runAsRoleChangeCaller(roleChangeCallerFor(authorizedUser), () =>
          dispatcher.dispatch(dispatchRequest)
        )
      )
  );

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
    // Any error carrying a retry hint: RATE_LIMITED, DATABASE_BUSY.
    Object.assign(errorHeaders, retryAfterHeader(nextlyErr));
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
 * The audience of a route that publishes no widget at all.
 *
 * The public branding route passes this: it answers before a session exists,
 * so there is no reader to ask about, and it discards the workspace half that
 * would carry the cards anyway. Withholding everything is the direction that
 * cannot disclose, which is why it is the value spelled out rather than a
 * default the next caller inherits without noticing.
 */
const NO_WIDGETS: WidgetAudience = {
  visible: [],
  declared: new Set(),
  holds: () => false,
  heldActionGates: new Set(),
  token: visibilityToken([], []),
  // No reader and no cards, so no collection a card could name.
  readableCollections: new Set(),
};

/**
 * One declaration with the actions this reader may not see withheld.
 *
 * An `actions` widget's shortcuts each carry a gate of their own, and a
 * shortcut is a label and an href: shipped whole and hidden by the browser
 * afterwards, the protected ones are readable from the payload regardless.
 * A declared widget's empty-state action is the same kind of thing, and is
 * withheld the same way. Filtered on the same reading the card's own gate
 * gets. A declaration with neither passes through untouched.
 */
function actionsForAudience<
  W extends {
    id: string;
    actions?: readonly WidgetAction[];
    empty?: { message?: string; action?: object };
  },
>(widget: W, audience: WidgetAudience): W {
  const withheldEmpty = emptyForAudience(widget.empty, audience);
  if (widget.actions === undefined && withheldEmpty === widget.empty) {
    return widget;
  }
  return {
    ...widget,
    ...(widget.actions === undefined
      ? {}
      : {
          actions: widget.actions.filter(action =>
            audience.holds(action.requiredPermission)
          ),
        }),
    ...(withheldEmpty === undefined ? {} : { empty: withheldEmpty }),
  };
}

/**
 * A declared widget's empty state with its action withheld from a reader who
 * may not take it; the same object when there is nothing to withhold.
 */
function emptyForAudience<E extends { message?: string; action?: object }>(
  empty: E | undefined,
  audience: WidgetAudience
): E | undefined {
  if (empty?.action === undefined) return empty;
  // A link's permission, when it names one; an action opening the card's own settings has none,
  // since the admin offers it only where the reader can change that card's settings.
  const { action } = empty;
  const gate =
    "requiredPermission" in action &&
    typeof action.requiredPermission === "string"
      ? action.requiredPermission
      : undefined;
  if (audience.holds(gate)) return empty;
  const { action: _withheld, ...rest } = empty;
  return rest as E;
}

/**
 * One plugin's projection with the widgets this reader may not see withheld.
 *
 * 🔴 Withheld HERE, on the server, because a contributed widget is its whole
 * declaration: a `text` widget carries its prose and an `actions` widget its
 * links. The browser applies the same gate before drawing, and that is not a
 * control -- the payload is JSON, and reading it is the bypass. The key is
 * dropped rather than left as an empty array, which is the shape the
 * projection gives a plugin that contributed none.
 *
 * 🔴 And ONLY the declaration that won its id. Two plugins may contribute the
 * same id; `canonicalWidgets` and the admin's resolver both keep the FIRST,
 * so the first is the one the reader's verdict is about -- and a later
 * duplicate, gated on something the reader lacks and carrying its own prose,
 * would ship under the winner's clearance if the payload were filtered by id
 * alone. `shipped` runs across the plugins in the order they were declared,
 * which is the order both resolvers walk.
 */
function widgetsForAudience(
  plugin: PluginAdminMeta,
  audience: WidgetAudience,
  readable: ReadonlySet<string>,
  shipped: Set<string>
): PluginAdminMeta {
  if (plugin.widgets === undefined) return plugin;
  const { widgets, ...rest } = plugin;
  const visible: PluginAdminWidget[] = [];
  for (const widget of widgets) {
    if (!audience.declared.has(widget.id) || shipped.has(widget.id)) continue;
    shipped.add(widget.id);
    visible.push(
      collectionDefaultForReader(actionsForAudience(widget, audience), readable)
    );
  }
  return visible.length > 0 ? { ...rest, widgets: visible } : rest;
}

/**
 * Whether THIS process is serving a development server, from the runtime
 * environment.
 *
 * The one comparison every dev-only wire in this file answers from: the
 * `/admin/api/dev-reload` route exists only while this is true, and the
 * workspace payload tells the client exactly the same thing, so the browser
 * can never be told the stream exists while the route would refuse it — the
 * two answers are the same answer by construction.
 *
 * It reads the RUNTIME value deliberately. The admin's browser bundle cannot
 * answer this for itself: its copy of `NODE_ENV` was folded into the dist at
 * package build time, which says where the library was built, never where the
 * host is running.
 */
function isDevServerRuntime(): boolean {
  return process.env.NODE_ENV === "development";
}

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
   * The widgets THIS reader may be told exist, from every channel.
   *
   * A parameter rather than a call, because the answer depends on the reader
   * and this builder is shared with the PUBLIC branding route, which passes
   * {@link NO_WIDGETS} and discards `workspace` anyway. Required rather than
   * defaulted, so a new caller has to say who is asking.
   */
  audience: WidgetAudience
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

  // The dev-reload subscription answer, from the same runtime comparison that
  // gates the route itself. The client's bundled `NODE_ENV` cannot say this —
  // it was folded when the admin package was built — so the server's answer is
  // the only one the browser can act on: subscribe exactly when the stream it
  // would dial exists.
  workspace.devReload = isDevServerRuntime();

  // Whether the widget preview page exists, from the same comparison that
  // gates its read below, so the admin registers the page exactly when the
  // read it draws from answers. Its own field rather than `devReload`: each
  // says what the admin may do with it, and a later rule for one (a config
  // switch, say) must not move the other.
  workspace.widgetPreviews = isDevServerRuntime();

  // The site's languages for the admin (present only when i18n is enabled): the language list as
  // it is now, so a language added in Settings shows without a restart.
  const localization = appLocalization() ?? config?.localization;
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
  const shipped = new Set<string>();
  // The collections this reader may read, as the layout judges them: a widget
  // declaration below ships its Collection setting's default only when it
  // names one of them (`collectionDefaultForReader`).
  const readable = audience.readableCollections;
  const plugins = buildPluginAdminMeta(
    config?.plugins ?? [],
    pluginOverrides
  ).map(plugin => widgetsForAudience(plugin, audience, readable, shipped));
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
  //
  // 🔴 Filtered for the reader, like the contributions above. A registration
  // is a whole declaration -- a `text` widget's prose, an `actions` widget's
  // links -- so shipping every one and leaving the browser to hide the gated
  // cards hands a reader the contents of a card they may not see.
  const widgets = publishableWidgets()
    .filter(widget => audience.declared.has(widget.id))
    .map(widget =>
      collectionDefaultForReader(actionsForAudience(widget, audience), readable)
    );
  if (widgets.length > 0) {
    workspace.widgets = widgets;
  }
  // What a card's content settings may offer this reader, derived from the
  // cards above: a collection is offered exactly when its own card is.
  const widgetSources = publishableContentSources(audience.readableCollections);
  if (widgetSources.length > 0) {
    workspace.widgetSources = widgetSources;
  }
  // The audience both widget channels above were filtered for, as the layout
  // read also reports it: the admin compares the two to learn that a payload
  // it has held for minutes was built for a different reader than the layout
  // in front of it -- a grant, a role change -- and reads it again.
  workspace.widgetAudience = audience.token;

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
    consoleLogger.error("[ADMIN-META] Error fetching settings from DB", {
      error: err,
    });
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
 * A refusal at the route gate, before dispatch. For a method whose answers
 * belong to one caller, the refusal does too: a shared cache replaying one
 * person's 401 or 403 to another hides from them what they may read.
 */
function refuseRequest(
  req: Request,
  method: string,
  refusal: Parameters<typeof createJsonErrorResponse>[0]
): Response {
  // Answered with the request's own id, as every other error is.
  const response = createJsonErrorResponse(refusal, req);
  // A named entry answered as missing depends on who asked, unlike a missing
  // entry's 404, and a 404 is cacheable by default: kept private, so a shared
  // cache never replays one caller's answer to another who may read it.
  return SESSION_PRIVATE_METHODS.has(method) || refusal.statusCode === 404
    ? withSessionCacheHeaders(response)
    : response;
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
  // A history page marks where the caller last looked, and a comparison can
  // start from it, so both answer one person.
  "listEntryVersions",
  "listSingleVersions",
  "getEntryVersionDiff",
  "getSingleVersionDiff",
  // Whether a document's events are readable depends on who asks, so neither
  // the list nor the refusal is shared between callers.
  "listEntryEvents",
  "listSingleEvents",
]);

// Re-exported from its neutral home so the dispatchers that import it from
// here keep working, while the plugin-route dispatch can reach the values
// without importing this module and closing a cycle.
export { withSessionCacheHeaders };

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
  const { branding } = await buildAdminMeta(NO_WIDGETS);
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
    return withSessionCacheHeaders(createJsonErrorResponse(auth, req));
  }

  // After the authentication precondition, never before it. Service
  // initialisation is lazy, so on the first authenticated request of a process
  // booted through `createDynamicHandlers` the container is still empty — and
  // `buildAdminMeta` would then silently skip the persisted sidebar groups and
  // branding overrides and describe the pre-boot plugin configuration instead
  // of the running one.
  await ensureServicesInitialized();

  // 🔴 Which widgets this reader may be told about is decided HERE rather than
  // inside `buildAdminMeta`, and by the SAME implementation the layout endpoint
  // places and offers with, so the two cannot disagree about what a reader may
  // see. A declaration is its whole content -- a Collection setting's default
  // names a COLLECTION, a `text` widget carries its prose -- so publishing the
  // whole set and leaving the browser to hide the gated ones would disclose
  // collections the reader may not read and the body of every gated card to
  // any authenticated caller. That the admin would not draw the card
  // is not a control; the payload is JSON, and reading it is the bypass.
  //
  // `widgetAudience` refreshes the content sources per request, which is why
  // it runs on this route and not in the shared builder: the PUBLIC branding
  // handler deliberately does not initialise services, and refreshing there
  // asked an empty container for the collection registry on every anonymous
  // login-page request, for a payload that discards the cards anyway.
  const caller = readAccessCaller(await readCaller(auth));
  const audience = await widgetAudience(caller);

  // Dispatched outside the content requests that bring the language list up to date, so it does
  // so itself: a language added on another server reaches the admin within the registry's
  // interval rather than whenever unrelated content traffic next arrives here.
  const { workspace } = await withCurrentLanguages(() =>
    buildAdminMeta(audience)
  );
  return withSessionCacheHeaders(respondAdminMeta(workspace));
}

/**
 * The catch-all Email routes whose grant is not their verb's action, each the
 * system policy's entry for what it does, as the standalone routes ask it:
 * choosing a provider type is a read or a create, making a provider the
 * default updates it, and a test send through a provider or a template
 * preview creates nothing stored and asks create.
 */
const EMAIL_METHOD_GRANTS: Readonly<Record<string, RouteGrant>> = {
  listProviderTypes: SYSTEM_READ_POLICY.emailProviders.readTypes,
  setDefault: SYSTEM_WRITE_POLICY.emailProviders.makeDefault,
  testProvider: SYSTEM_WRITE_POLICY.emailProviders.sendTest,
  previewTemplate: SYSTEM_WRITE_POLICY.emailTemplates.preview,
};

/**
 * The grant a catch-all Email route asks, read from the system policies:
 * its method's own entry where it has one, else the entry for the action its
 * verb names. A `manage-` permission counts as each plain one.
 */
function emailGrant(
  resource: "emailProviders" | "emailTemplates",
  method: string,
  httpMethod: string
): RouteGrant {
  const named = EMAIL_METHOD_GRANTS[method];
  if (named) return named;
  const action = getActionFromMethod(httpMethod);
  if (action === "create" || action === "update" || action === "delete") {
    return SYSTEM_WRITE_POLICY[resource][action];
  }
  return SYSTEM_READ_POLICY[resource].read;
}

/**
 * PATCH /api/admin-meta/sidebar-groups
 *
 * Replaces the custom sidebar groups array.
 * Auth: a settings change (`update-settings`).
 *
 * Body: { groups: [{ slug, name, icon? }, ...] }
 */
async function handleAdminMetaSidebarGroups(req: Request): Promise<Response> {
  try {
    const authResult = await requireListRead(
      req,
      SYSTEM_WRITE_POLICY.settings.update
    );
    if (isErrorResponse(authResult)) {
      return createJsonErrorResponse(authResult, req);
    }

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
  // Each branch the built-in router answers before `handleServiceRequest`
  // passes the REST limit first, as that function's own routes do.
  if (params[0] === "admin-meta" && params[1] === "workspace") {
    return withinBuiltInLimit(() => handleAdminMetaWorkspaceRequest(req));
  }
  if (params[0] === "admin-meta") {
    return withinBuiltInLimit(() => handleAdminMetaRequest());
  }
  if (params[0] === "dev-reload" && isDevServerRuntime()) {
    return withinBuiltInLimit(() => devReloadStream());
  }
  if (isWidgetPreviewsPath(params) && isDevServerRuntime()) {
    return withinBuiltInLimit(() => widgetPreviewsRead(req));
  }
  return handleServiceRequest(req, params, "GET");
}

/**
 * Whether the path is exactly `/_dev/widget-previews`, nothing beneath it.
 * Under `_dev`, the first segment kept for development-only endpoints, which
 * a plugin's root route can never claim (`root-mount-reach`).
 */
function isWidgetPreviewsPath(params: string[]): boolean {
  return (
    params.length === 2 &&
    params[0] === "_dev" &&
    params[1] === "widget-previews"
  );
}

/**
 * The widget preview read, for the dev server only.
 *
 * 🔴 Matched here, before the built-in router, and only while
 * `isDevServerRuntime()` holds: anywhere else the request falls through to
 * the router, which has no such route, so a production server answers it as
 * it answers any path it does not serve, and nothing in the answer says a
 * preview read exists. A gate inside a routed handler would answer a refusal
 * of its own, which a caller could tell apart from an unknown path.
 *
 * Services start only for a request that presents a credential, as for the
 * dashboard's other reads (`DIRECT_DISPATCH_SERVICES`): one with none is
 * refused by the read's own authentication without starting anything.
 */
async function widgetPreviewsRead(req: Request): Promise<Response> {
  if (
    req.headers.get("authorization") !== null ||
    readAccessTokenCookie(req) !== null
  ) {
    await ensureServicesInitialized();
  }
  return getWidgetPreviews(req);
}

/** The development reload stream, for the dev server only. */
async function devReloadStream(): Promise<Response> {
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

async function handlePost(req: Request, params: string[]) {
  if (params[0] === "_dev" && isDevServerRuntime()) {
    return withinBuiltInLimit(() =>
      handleDevSchemaRequest(req, params, "POST")
    );
  }
  return handleServiceRequest(req, params, "POST");
}

async function handlePut(req: Request, params: string[]) {
  return handleServiceRequest(req, params, "PUT");
}

async function handlePatch(req: Request, params: string[]) {
  if (params[0] === "admin-meta" && params[1] === "sidebar-groups") {
    return withinBuiltInLimit(() => handleAdminMetaSidebarGroups(req));
  }
  return handleServiceRequest(req, params, "PATCH");
}

async function handleDelete(req: Request, params: string[]) {
  if (params[0] === "_dev" && isDevServerRuntime()) {
    return withinBuiltInLimit(() =>
      handleDevSchemaRequest(req, params, "DELETE")
    );
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
    // And the document views: two screens claiming one address on one
    // document would leave the admin drawing whichever it reached first.
    assertDocumentViews(options.config.plugins ?? []);
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
    | Parameters<typeof createRestLimits>[0]
    | undefined;
  // The default keyGenerator needs the trust-proxy settings so it
  // can resolve a real client IP rather than blindly trusting
  // X-Forwarded-For. Inject from `security.trustProxy` +
  // TRUSTED_PROXY_IPS env unless the user supplied an override.
  const trustedProxyIpsFromEnv = (process.env.TRUSTED_PROXY_IPS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  // The readers can start services, so a request presenting an API key is
  // classified by that key on a cold worker too, as the route would boot for
  // it next anyway.
  const restLimits = createRestLimits(
    {
      enabled: true,
      ...(rateLimitConfig ?? {}),
      // Where core's own limits count, read per call: the services may not
      // be registered yet when the handler is built.
      store: restLimitCounts(rateLimitConfig, ensureServicesInitialized),
      trustProxy:
        rateLimitConfig?.trustProxy ?? securityConfig?.trustProxy ?? false,
      trustedProxyIps:
        rateLimitConfig?.trustedProxyIps ?? trustedProxyIpsFromEnv,
    },
    defaultRestCallerReaders(ensureServicesInitialized)
  );

  /**
   * The REST limit's target when it can be decided before routing, or
   * `null` when a plugin route may take the request and decides it.
   *
   * @param authRouted - Whether this verb sends `/auth/*` to the auth router.
   */
  function limitBeforeRouting(
    params: string[],
    method: string,
    authRouted: boolean
  ): RestLimitTarget | null {
    // Only the auth paths the auth limit judges are left to it; every other
    // `/auth/*` request is held to the REST limit like any request.
    if (authRouted && isAuthRoute(params)) {
      return hasAuthRateLimit(method, params.slice(1).join("/"))
        ? "auth"
        : "core";
    }
    return mayReachPluginRoute(method, params) ? null : "core";
  }

  /**
   * Wrap a handler with rate limiting, CORS, and security headers.
   *
   * Order:
   * 1. CORS preflight — if OPTIONS, return immediately with security headers
   * 2. Rate limit check — if exceeded, return 429 with security headers.
   *    Decided here when `limitFirst` names a target; otherwise by the
   *    plugin route or built-in branch the request reaches, before its work.
   * 3. Run the actual handler
   * 4. Apply CORS headers to the response
   * 5. Apply security headers to the response
   */
  async function withSecurity(
    req: Request,
    limitFirst: RestLimitTarget | null,
    handler: () => Promise<Response>
  ): Promise<Response> {
    // CORS preflight intercept
    const preflightResponse = cors.handlePreflight(req);
    if (preflightResponse) {
      return applySecurityHeaders(preflightResponse);
    }

    // Rate limit check — before running any handler logic
    const gate = openRestLimitGate(restLimits, req);
    const rateLimitResponse =
      limitFirst === null ? null : await gate.settle(limitFirst);
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
        // One memo of access lookups per request, so every gate, rule and
        // field rule the request reaches asks the database about its caller
        // once rather than each time.
        return await runWithAccessMemo(() =>
          runWithRestLimitGate(gate, handler)
        );
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
    // A path that settled nothing would leave the request uncounted. It is
    // counted now, after the fact, and logged so the path can be found.
    if (gate.pending) {
      await gate.settle("core");
      resolveLogger().warn({
        kind: "rest-limit-settled-late",
        requestId: effectiveRequestId,
        route: new URL(req.url).pathname,
        method: req.method,
      });
    }
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
      return withSecurity(
        req,
        limitBeforeRouting(paramsList, "GET", true),
        async () => {
          if (isAuthRoute(paramsList))
            return handleAuthRequest(req, paramsList, "GET");
          return handleGet(req, paramsList);
        }
      );
    },
    POST: async (
      req: Request,
      ctx: { params: Promise<{ params?: string[] }> }
    ) => {
      const resolvedParams = await ctx.params;
      const paramsList = resolvedParams.params || [];
      return withSecurity(
        req,
        limitBeforeRouting(paramsList, "POST", true),
        async () => {
          if (isAuthRoute(paramsList))
            return handleAuthRequest(req, paramsList, "POST");
          return handlePost(req, paramsList);
        }
      );
    },
    PUT: async (
      req: Request,
      ctx: { params: Promise<{ params?: string[] }> }
    ) => {
      const resolvedParams = await ctx.params;
      const paramsList = resolvedParams.params || [];
      return withSecurity(
        req,
        limitBeforeRouting(paramsList, "PUT", false),
        async () => {
          return handlePut(req, paramsList);
        }
      );
    },
    PATCH: async (
      req: Request,
      ctx: { params: Promise<{ params?: string[] }> }
    ) => {
      const resolvedParams = await ctx.params;
      const paramsList = resolvedParams.params || [];
      return withSecurity(
        req,
        limitBeforeRouting(paramsList, "PATCH", true),
        async () => {
          if (isAuthRoute(paramsList))
            return handleAuthRequest(req, paramsList, "PATCH");
          return handlePatch(req, paramsList);
        }
      );
    },
    DELETE: async (
      req: Request,
      ctx: { params: Promise<{ params?: string[] }> }
    ) => {
      const resolvedParams = await ctx.params;
      const paramsList = resolvedParams.params || [];
      return withSecurity(
        req,
        limitBeforeRouting(paramsList, "DELETE", false),
        async () => {
          return handleDelete(req, paramsList);
        }
      );
    },
    OPTIONS: async (req: Request) => {
      // eslint-disable-next-line @typescript-eslint/require-await
      return withSecurity(req, "core", async () => {
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
 * The route param names identity used to travel under. Nothing writes or reads
 * them any more, but `parseRestRoute` copies every query-string key into
 * `routeParams`, so a client can still send them; they are dropped before
 * dispatch, so a handler that ever read one again would find nothing forged.
 */
const RESERVED_IDENTITY_PARAMS = [
  "_authenticatedUserId",
  "_authenticatedUserName",
  "_authenticatedUserEmail",
  "_authenticatedUserRoles",
  "_authenticatedActorType",
  "_authenticatedActorId",
  "_authenticatedPermissions",
  "_authenticatedClaims",
] as const;

function stripReservedIdentityParams(
  routeParams: Record<string, string> | undefined
): void {
  if (!routeParams) return;
  for (const name of RESERVED_IDENTITY_PARAMS) delete routeParams[name];
}

/**
 * Who the authorized caller is, for the handlers dispatched on its behalf,
 * carried in request context (`runWithRequestCaller`) rather than in params.
 *
 * The acting identity is resolved here, the only place that knows how the
 * request authenticated: a write attributes to the API key itself when one was
 * used, rather than silently to the user that owns the key. Verified extra
 * claims travel with it, so a rule decides on the same identity over HTTP that
 * it gets through the Direct API.
 */
async function requestCallerFor(
  authorizedUser: AuthContext | undefined,
  // Whether the handler hands roles to access rules, per
  // {@link needsResolvedRoles}. Roles are resolved (a DB query for session auth)
  // only when needed, so routes that never read them don't pay for a lookup.
  needsRoles: boolean
): Promise<RequestCaller | undefined> {
  if (!authorizedUser) return undefined;
  const roles = needsRoles
    ? ((await resolveRoleSlugs(authorizedUser)) ?? [])
    : undefined;
  return Object.freeze({
    userId: authorizedUser.userId,
    ...(authorizedUser.userName ? { name: authorizedUser.userName } : {}),
    ...(authorizedUser.userEmail ? { email: authorizedUser.userEmail } : {}),
    ...(authorizedUser.claims
      ? { claims: Object.freeze({ ...authorizedUser.claims }) }
      : {}),
    actor: Object.freeze(actorFromAuthContext(authorizedUser)),
    ...(roles ? { roles: Object.freeze([...roles]) } : {}),
    // The action a write route admitted the caller on, where it accepts
    // several, so the dispatch attests only an update the route ran.
    ...(admittedActionOf(authorizedUser)
      ? { routeAction: admittedActionOf(authorizedUser) }
      : {}),
  });
}

export const _requestCallerForTest = requestCallerFor;
export const _stripReservedIdentityParamsForTest = stripReservedIdentityParams;
