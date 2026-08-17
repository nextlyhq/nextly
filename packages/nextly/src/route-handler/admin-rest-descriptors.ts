/**
 * Admin REST operation introspection (the plugin-facing seam).
 *
 * `listAdminRestOperations()` answers one general question — "what REST
 * operations does the admin catch-all expose?" — with no opinion about who
 * consumes the answer. The OpenAPI docs plugin (@nextlyhq/plugin-api-docs) turns
 * this into a spec; future tooling (client generators, health checks, permission
 * auditors) can consume the same list without re-deriving it.
 *
 * The catch-all's routing is imperative across four layers (route-parser →
 * dispatcher switch → per-domain method maps → direct-dispatch handlers), with
 * no declarative table to iterate. Rather than refactor dispatch, this module is
 * a read-only declarative view of the same operations, kept honest by an
 * agreement test: every listed operation's name must exist in the live
 * `*_METHODS` map for its service, so a renamed dispatcher method fails the test
 * rather than silently producing a stale list.
 *
 * `path` is relative to the catch-all mount root with a leading slash and
 * `{param}` placeholders (`/users/{userId}`); consumers join it with whatever
 * mount the host app uses (commonly `/admin/api`). `envelope` names the
 * canonical response shape (`api/response-shapes.ts`); `permissionSlug` may be a
 * `{collectionName}` / `{slug}` template where the target is user-defined.
 *
 * @module route-handler/admin-rest-descriptors
 * @since alpha
 */

// ============================================================
// Types
// ============================================================

/** Uppercase HTTP verb an operation is served under. */
export type RestHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * How an operation is secured.
 * - `public`: no authentication.
 * - `authenticated`: a valid session/API key, but no specific permission.
 * - `permission`: gated by an RBAC permission (`permissionSlug`).
 */
export type RestAuthMode = "public" | "authenticated" | "permission";

/** The canonical response envelope the operation answers with. */
export type RestEnvelope =
  "list" | "doc" | "mutation" | "action" | "data" | "total" | "bulk";

/** A single admin REST operation, as seen by introspection consumers. */
export interface AdminRestOperation {
  /** Service name (the dispatcher's `ServiceType`, e.g. "users"). */
  service: string;
  /** The dispatcher method name — the operation identity + agreement key. */
  operation: string;
  /** HTTP verb. */
  method: RestHttpMethod;
  /** Path relative to the mount root, leading "/", `{param}` placeholders. */
  path: string;
  /** How the operation is secured. */
  auth: RestAuthMode;
  /** Required when `auth === "permission"`; an RBAC slug (may be templated). */
  permissionSlug?: string;
  /** Grouping label for consumers that present a list (e.g. a tag). */
  tag: string;
  /** The canonical response envelope kind. */
  envelope: RestEnvelope;
}

// ============================================================
// Table factory — keeps the per-service tables compact and uniform.
// ============================================================

type Row = [
  operation: string,
  method: RestHttpMethod,
  path: string,
  auth: RestAuthMode,
  permissionSlug: string | undefined,
  envelope: RestEnvelope,
];

function ops(
  service: string,
  tag: string,
  rows: readonly Row[]
): AdminRestOperation[] {
  return rows.map(
    ([operation, method, path, auth, permissionSlug, envelope]) => ({
      service,
      operation,
      method,
      path,
      auth,
      permissionSlug: permissionSlug ?? undefined,
      tag,
      envelope,
    })
  );
}

// ============================================================
// users — verified against the live USER_METHODS map
// ============================================================

const users = ops("users", "Users", [
  ["getCurrentUser", "GET", "/me", "authenticated", undefined, "doc"],
  ["updateCurrentUser", "PATCH", "/me", "authenticated", undefined, "mutation"],
  [
    "getCurrentUserPermissions",
    "GET",
    "/me/permissions",
    "authenticated",
    undefined,
    "data",
  ],
  ["listUsers", "GET", "/users", "permission", "read-users", "list"],
  [
    "createLocalUser",
    "POST",
    "/users",
    "permission",
    "create-users",
    "mutation",
  ],
  ["getUserById", "GET", "/users/{userId}", "permission", "read-users", "doc"],
  [
    "updateUser",
    "PATCH",
    "/users/{userId}",
    "permission",
    "update-users",
    "mutation",
  ],
  [
    "deleteUser",
    "DELETE",
    "/users/{userId}",
    "permission",
    "delete-users",
    "mutation",
  ],
  [
    "updatePasswordHash",
    "PATCH",
    "/users/{userId}/password",
    "permission",
    "update-users",
    "action",
  ],
  [
    "getAccounts",
    "GET",
    "/users/{userId}/accounts",
    "permission",
    "read-users",
    "data",
  ],
  // resolveAuthorization derives the action from the verb: DELETE → delete-users.
  [
    "unlinkAccountForUser",
    "DELETE",
    "/users/{userId}/accounts/{provider}/{providerAccountId}",
    "permission",
    "delete-users",
    "action",
  ],
]);

// ============================================================
// rbac — roles, permissions, user-role assignment
// ============================================================

const rbac = ops("rbac", "Roles & Permissions", [
  ["createRole", "POST", "/roles", "permission", "create-roles", "mutation"],
  ["listRoles", "GET", "/roles", "permission", "read-roles", "list"],
  ["getRoleById", "GET", "/roles/{roleId}", "permission", "read-roles", "doc"],
  [
    "updateRole",
    "PATCH",
    "/roles/{roleId}",
    "permission",
    "update-roles",
    "mutation",
  ],
  [
    "deleteRole",
    "DELETE",
    "/roles/{roleId}",
    "permission",
    "delete-roles",
    "mutation",
  ],
  [
    "addRoleInheritance",
    "POST",
    "/roles/{parentRoleId}/children",
    "permission",
    "update-roles",
    "action",
  ],
  [
    "listDescendantRoles",
    "GET",
    "/roles/{roleId}/children",
    "permission",
    "read-roles",
    "data",
  ],
  [
    "removeRoleInheritance",
    "DELETE",
    "/roles/{parentRoleId}/children/{childRoleId}",
    "permission",
    "update-roles",
    "action",
  ],
  [
    "listAncestorRoles",
    "GET",
    "/roles/{roleId}/parents",
    "permission",
    "read-roles",
    "data",
  ],
  [
    "setRolePermissions",
    "PATCH",
    "/roles/{roleId}/permissions",
    "permission",
    "update-roles",
    "action",
  ],
  [
    "addPermissionToRole",
    "POST",
    "/roles/{roleId}/permissions",
    "permission",
    "update-roles",
    "action",
  ],
  [
    "listRolePermissions",
    "GET",
    "/roles/{roleId}/permissions",
    "permission",
    "read-roles",
    "data",
  ],
  [
    "removePermissionFromRole",
    "DELETE",
    "/roles/{roleId}/permissions/{permissionId}",
    "permission",
    "update-roles",
    "action",
  ],
  [
    "ensurePermission",
    "POST",
    "/permissions",
    "permission",
    "manage-permissions",
    "mutation",
  ],
  [
    "listPermissions",
    "GET",
    "/permissions",
    "permission",
    "read-roles",
    "list",
  ],
  [
    "getPermissionById",
    "GET",
    "/permissions/{permissionId}",
    "permission",
    "read-roles",
    "doc",
  ],
  [
    "updatePermission",
    "PATCH",
    "/permissions/{permissionId}",
    "permission",
    "manage-permissions",
    "mutation",
  ],
  [
    "deletePermissionById",
    "DELETE",
    "/permissions/{permissionId}",
    "permission",
    "manage-permissions",
    "mutation",
  ],
  [
    "assignRoleToUser",
    "POST",
    "/users/{userId}/roles",
    "permission",
    "update-users",
    "action",
  ],
  [
    "listUserRoles",
    "GET",
    "/users/{userId}/roles",
    "permission",
    "read-roles",
    "data",
  ],
  [
    "unassignRoleFromUser",
    "DELETE",
    "/users/{userId}/roles/{roleId}",
    "permission",
    "update-users",
    "action",
  ],
]);

// ============================================================
// collections — definitions, entries, bulk, versions
// The {collectionName} slug drives the per-collection permission.
// ============================================================

const collections = ops("collections", "Collections", [
  [
    "listCollections",
    "GET",
    "/collections",
    "authenticated",
    undefined,
    "list",
  ],
  [
    "createCollection",
    "POST",
    "/collections",
    "permission",
    "manage-settings",
    "mutation",
  ],
  [
    "getCollection",
    "GET",
    "/collections/schema/{collectionName}",
    "permission",
    "read-{collectionName}",
    "doc",
  ],
  [
    "updateCollection",
    "PATCH",
    "/collections/{collectionName}",
    "permission",
    "manage-settings",
    "mutation",
  ],
  [
    "deleteCollection",
    "DELETE",
    "/collections/{collectionName}",
    "permission",
    "manage-settings",
    "mutation",
  ],
  [
    "previewSchemaChanges",
    "POST",
    "/collections/schema/{collectionName}/preview",
    "permission",
    "manage-settings",
    "data",
  ],
  [
    "applySchemaChanges",
    "POST",
    "/collections/schema/{collectionName}/apply",
    "permission",
    "manage-settings",
    "action",
  ],
  [
    "listEntries",
    "GET",
    "/collections/{collectionName}/entries",
    "permission",
    "read-{collectionName}",
    "list",
  ],
  [
    "createEntry",
    "POST",
    "/collections/{collectionName}/entries",
    "permission",
    "create-{collectionName}",
    "mutation",
  ],
  [
    "bulkUpdateByQuery",
    "PATCH",
    "/collections/{collectionName}/entries",
    "permission",
    "update-{collectionName}",
    "bulk",
  ],
  [
    "bulkDeleteEntries",
    "POST",
    "/collections/{collectionName}/entries/bulk-delete",
    "permission",
    "delete-{collectionName}",
    "bulk",
  ],
  [
    "bulkUpdateEntries",
    "POST",
    "/collections/{collectionName}/entries/bulk-update",
    "permission",
    "update-{collectionName}",
    "bulk",
  ],
  [
    "countEntries",
    "GET",
    "/collections/{collectionName}/entries/count",
    "permission",
    "read-{collectionName}",
    "total",
  ],
  [
    "getEntry",
    "GET",
    "/collections/{collectionName}/entries/{entryId}",
    "permission",
    "read-{collectionName}",
    "doc",
  ],
  [
    "updateEntry",
    "PATCH",
    "/collections/{collectionName}/entries/{entryId}",
    "permission",
    "update-{collectionName}",
    "mutation",
  ],
  [
    "deleteEntry",
    "DELETE",
    "/collections/{collectionName}/entries/{entryId}",
    "permission",
    "delete-{collectionName}",
    "mutation",
  ],
  [
    "duplicateEntry",
    "POST",
    "/collections/{collectionName}/entries/{entryId}/duplicate",
    "permission",
    "create-{collectionName}",
    "mutation",
  ],
  [
    "publishAllLocales",
    "POST",
    "/collections/{collectionName}/entries/{entryId}/publish-all",
    "permission",
    "update-{collectionName}",
    "mutation",
  ],
  [
    "listEntryVersions",
    "GET",
    "/collections/{collectionName}/entries/{entryId}/versions",
    "permission",
    "read-{collectionName}",
    "list",
  ],
  [
    "getEntryVersion",
    "GET",
    "/collections/{collectionName}/entries/{entryId}/versions/{versionNo}",
    "permission",
    "read-{collectionName}",
    "doc",
  ],
  [
    "getEntryVersionDiff",
    "GET",
    "/collections/{collectionName}/entries/{entryId}/versions/diff",
    "permission",
    "read-{collectionName}",
    "doc",
  ],
  [
    "setEntryVersionLabel",
    "PATCH",
    "/collections/{collectionName}/entries/{entryId}/versions/{versionNo}",
    "permission",
    "update-{collectionName}",
    "mutation",
  ],
  [
    "restoreEntryVersion",
    "POST",
    "/collections/{collectionName}/entries/{entryId}/versions/{versionNo}/restore",
    "permission",
    "update-{collectionName}",
    "action",
  ],
  [
    "discardWorkingDraft",
    "DELETE",
    "/collections/{collectionName}/entries/{entryId}/versions/working-draft",
    "permission",
    "update-{collectionName}",
    "mutation",
  ],
]);

// ============================================================
// singles — documents, schema, versions
// ============================================================

const singles = ops("singles", "Singles", [
  ["listSingles", "GET", "/singles", "authenticated", undefined, "list"],
  [
    "createSingle",
    "POST",
    "/singles",
    "permission",
    "manage-settings",
    "mutation",
  ],
  [
    "getSingleDocument",
    "GET",
    "/singles/{slug}",
    "permission",
    "read-{slug}",
    "doc",
  ],
  [
    "updateSingleDocument",
    "PATCH",
    "/singles/{slug}",
    "permission",
    "update-{slug}",
    "mutation",
  ],
  [
    "deleteSingle",
    "DELETE",
    "/singles/{slug}",
    "permission",
    "manage-settings",
    "action",
  ],
  [
    "getSingleSchema",
    "GET",
    "/singles/{slug}/schema",
    "permission",
    "read-{slug}",
    "doc",
  ],
  [
    "updateSingleSchema",
    "PATCH",
    "/singles/{slug}/schema",
    "permission",
    "manage-settings",
    "mutation",
  ],
  [
    "previewSingleSchemaChanges",
    "POST",
    "/singles/schema/{slug}/preview",
    "permission",
    "manage-settings",
    "data",
  ],
  [
    "applySingleSchemaChanges",
    "POST",
    "/singles/schema/{slug}/apply",
    "permission",
    "manage-settings",
    "action",
  ],
  [
    "listSingleVersions",
    "GET",
    "/singles/{slug}/versions",
    "permission",
    "read-{slug}",
    "list",
  ],
  [
    "getSingleVersion",
    "GET",
    "/singles/{slug}/versions/{versionNo}",
    "permission",
    "read-{slug}",
    "doc",
  ],
  [
    "getSingleVersionDiff",
    "GET",
    "/singles/{slug}/versions/diff",
    "permission",
    "read-{slug}",
    "doc",
  ],
  [
    "setSingleVersionLabel",
    "PATCH",
    "/singles/{slug}/versions/{versionNo}",
    "permission",
    "update-{slug}",
    "mutation",
  ],
  [
    "restoreSingleVersion",
    "POST",
    "/singles/{slug}/versions/{versionNo}/restore",
    "permission",
    "update-{slug}",
    "action",
  ],
]);

// ============================================================
// forms — public submission surface
// ============================================================

const forms = ops("forms", "Forms", [
  ["listForms", "GET", "/forms", "public", undefined, "list"],
  ["getFormBySlug", "GET", "/forms/{slug}", "public", undefined, "doc"],
  ["submitForm", "POST", "/forms/{slug}/submit", "public", undefined, "action"],
]);

// ============================================================
// field-groups (components)
// ============================================================

const fieldGroups = ops("field-groups", "Field Groups", [
  [
    "listComponents",
    "GET",
    "/field-groups",
    "authenticated",
    undefined,
    "list",
  ],
  [
    "createComponent",
    "POST",
    "/field-groups",
    "permission",
    "manage-settings",
    "mutation",
  ],
  [
    "previewComponentSchemaChanges",
    "POST",
    "/field-groups/schema/{slug}/preview",
    "permission",
    "manage-settings",
    "data",
  ],
  [
    "applyComponentSchemaChanges",
    "POST",
    "/field-groups/schema/{slug}/apply",
    "permission",
    "manage-settings",
    "action",
  ],
  [
    "getComponent",
    "GET",
    "/field-groups/{slug}",
    "authenticated",
    undefined,
    "doc",
  ],
  [
    "updateComponent",
    "PATCH",
    "/field-groups/{slug}",
    "permission",
    "manage-settings",
    "mutation",
  ],
  [
    "deleteComponent",
    "DELETE",
    "/field-groups/{slug}",
    "permission",
    "manage-settings",
    "action",
  ],
]);

// ============================================================
// email providers + templates, user fields
// ============================================================

const emailProviders = ops("emailProviders", "Email Providers", [
  [
    "listProviders",
    "GET",
    "/email-providers",
    "permission",
    "manage-email-providers",
    "data",
  ],
  [
    "listProviderTypes",
    "GET",
    "/email-providers/types",
    "permission",
    "manage-email-providers",
    "data",
  ],
  [
    "createProvider",
    "POST",
    "/email-providers",
    "permission",
    "manage-email-providers",
    "mutation",
  ],
  [
    "getProvider",
    "GET",
    "/email-providers/{providerId}",
    "permission",
    "manage-email-providers",
    "doc",
  ],
  [
    "updateProvider",
    "PATCH",
    "/email-providers/{providerId}",
    "permission",
    "manage-email-providers",
    "mutation",
  ],
  [
    "deleteProvider",
    "DELETE",
    "/email-providers/{providerId}",
    "permission",
    "manage-email-providers",
    "action",
  ],
  [
    "setDefault",
    "PATCH",
    "/email-providers/{providerId}/default",
    "permission",
    "manage-email-providers",
    "action",
  ],
  [
    "testProvider",
    "POST",
    "/email-providers/{providerId}/test",
    "permission",
    "manage-email-providers",
    "action",
  ],
]);

const emailTemplates = ops("emailTemplates", "Email Templates", [
  [
    "listTemplates",
    "GET",
    "/email-templates",
    "permission",
    "manage-email-templates",
    "data",
  ],
  [
    "createTemplate",
    "POST",
    "/email-templates",
    "permission",
    "manage-email-templates",
    "mutation",
  ],
  [
    "previewTemplate",
    "POST",
    "/email-templates/{templateId}/preview",
    "permission",
    "manage-email-templates",
    "data",
  ],
  [
    "getTemplate",
    "GET",
    "/email-templates/{templateId}",
    "permission",
    "manage-email-templates",
    "doc",
  ],
  [
    "updateTemplate",
    "PATCH",
    "/email-templates/{templateId}",
    "permission",
    "manage-email-templates",
    "mutation",
  ],
  [
    "deleteTemplate",
    "DELETE",
    "/email-templates/{templateId}",
    "permission",
    "manage-email-templates",
    "action",
  ],
]);

const userFields = ops("userFields", "User Fields", [
  [
    "listUserFields",
    "GET",
    "/user-fields",
    "permission",
    "manage-settings",
    "data",
  ],
  [
    "createField",
    "POST",
    "/user-fields",
    "permission",
    "manage-settings",
    "mutation",
  ],
  [
    "reorderFields",
    "PATCH",
    "/user-fields/reorder",
    "permission",
    "manage-settings",
    "action",
  ],
  [
    "getField",
    "GET",
    "/user-fields/{fieldId}",
    "permission",
    "manage-settings",
    "doc",
  ],
  [
    "updateField",
    "PATCH",
    "/user-fields/{fieldId}",
    "permission",
    "manage-settings",
    "mutation",
  ],
  [
    "deleteField",
    "DELETE",
    "/user-fields/{fieldId}",
    "permission",
    "manage-settings",
    "action",
  ],
]);

// ============================================================
// apiKeys + webhooks — direct dispatch, umbrella update-* permission
// ============================================================

const apiKeys = ops("apiKeys", "API Keys", [
  ["listApiKeys", "GET", "/api-keys", "permission", "read-api-keys", "list"],
  [
    "createApiKey",
    "POST",
    "/api-keys",
    "permission",
    "create-api-keys",
    "mutation",
  ],
  [
    "getApiKeyById",
    "GET",
    "/api-keys/{apiKeyId}",
    "permission",
    "read-api-keys",
    "doc",
  ],
  [
    "updateApiKey",
    "PATCH",
    "/api-keys/{apiKeyId}",
    "permission",
    "update-api-keys",
    "mutation",
  ],
  [
    "revokeApiKey",
    "DELETE",
    "/api-keys/{apiKeyId}",
    "permission",
    "delete-api-keys",
    "action",
  ],
]);

const webhooks = ops("webhooks", "Webhooks", [
  ["listWebhooks", "GET", "/webhooks", "permission", "read-webhooks", "list"],
  [
    "createWebhook",
    "POST",
    "/webhooks",
    "permission",
    "create-webhooks",
    "mutation",
  ],
  [
    "getWebhookById",
    "GET",
    "/webhooks/{webhookId}",
    "permission",
    "read-webhooks",
    "doc",
  ],
  [
    "updateWebhook",
    "PATCH",
    "/webhooks/{webhookId}",
    "permission",
    "update-webhooks",
    "mutation",
  ],
  [
    "deleteWebhook",
    "DELETE",
    "/webhooks/{webhookId}",
    "permission",
    "delete-webhooks",
    "action",
  ],
  [
    "revealWebhookSecret",
    "GET",
    "/webhooks/{webhookId}/secret",
    "permission",
    "update-webhooks",
    "data",
  ],
  [
    "rotateWebhookSecret",
    "POST",
    "/webhooks/{webhookId}/secret/rotate",
    "permission",
    "update-webhooks",
    "mutation",
  ],
  [
    "expireWebhookOldSecrets",
    "POST",
    "/webhooks/{webhookId}/secret/expire-old",
    "permission",
    "update-webhooks",
    "mutation",
  ],
  [
    "listWebhookDeliveries",
    "GET",
    "/webhooks/{webhookId}/deliveries",
    "permission",
    "read-webhooks",
    "list",
  ],
  [
    "getWebhookDelivery",
    "GET",
    "/webhooks/{webhookId}/deliveries/{deliveryId}",
    "permission",
    "read-webhooks",
    "doc",
  ],
  [
    "redeliverWebhookDelivery",
    "POST",
    "/webhooks/{webhookId}/deliveries/{deliveryId}/redeliver",
    "permission",
    "update-webhooks",
    "mutation",
  ],
  [
    "testWebhookEndpoint",
    "POST",
    "/webhooks/{webhookId}/test",
    "permission",
    "update-webhooks",
    "action",
  ],
  [
    "drainWebhooks",
    "POST",
    "/webhooks/drain",
    "permission",
    "update-webhooks",
    "mutation",
  ],
]);

// ============================================================
// preview links, settings, image sizes, dashboard, schema, email, admin-meta
// ============================================================

const previewLinks = ops("previewLinks", "Preview Links", [
  [
    "mintPreviewLink",
    "POST",
    "/preview-links",
    "permission",
    "update-{collectionName}",
    "mutation",
  ],
  [
    "revokePreviewLinks",
    "POST",
    "/preview-links/revoke",
    "permission",
    "manage-settings",
    "mutation",
  ],
]);

const generalSettings = ops("generalSettings", "Settings", [
  [
    "getGeneralSettings",
    "GET",
    "/general-settings",
    "permission",
    "manage-settings",
    "data",
  ],
  [
    "updateGeneralSettings",
    "PATCH",
    "/general-settings",
    "permission",
    "manage-settings",
    "mutation",
  ],
]);

const imageSizes = ops("imageSizes", "Image Sizes", [
  [
    "imageSizes",
    "GET",
    "/image-sizes",
    "permission",
    "manage-settings",
    "list",
  ],
  [
    "createImageSize",
    "POST",
    "/image-sizes",
    "permission",
    "manage-settings",
    "mutation",
  ],
  [
    "getImageSizeById",
    "GET",
    "/image-sizes/{imageId}",
    "permission",
    "manage-settings",
    "doc",
  ],
  [
    "updateImageSize",
    "PATCH",
    "/image-sizes/{imageId}",
    "permission",
    "manage-settings",
    "mutation",
  ],
  [
    "deleteImageSize",
    "DELETE",
    "/image-sizes/{imageId}",
    "permission",
    "manage-settings",
    "action",
  ],
]);

const dashboard = ops("dashboard", "Dashboard", [
  [
    "getDashboardStats",
    "GET",
    "/dashboard/stats",
    "authenticated",
    undefined,
    "data",
  ],
  [
    "getDashboardRecentEntries",
    "GET",
    "/dashboard/recent-entries",
    "authenticated",
    undefined,
    "data",
  ],
  [
    "getDashboardActivity",
    "GET",
    "/dashboard/activity",
    "authenticated",
    undefined,
    "data",
  ],
]);

const schema = ops("schema", "Schema", [
  [
    "getSchemaJournal",
    "GET",
    "/schema/journal",
    "authenticated",
    undefined,
    "data",
  ],
]);

const email = ops("email", "Email", [
  ["send", "POST", "/email/send", "authenticated", undefined, "action"],
  [
    "sendWithTemplate",
    "POST",
    "/email/send-with-template",
    "authenticated",
    undefined,
    "action",
  ],
]);

const adminMeta = ops("admin-meta", "Admin Meta", [
  ["getAdminMeta", "GET", "/admin-meta", "public", undefined, "data"],
  [
    "updateAdminMetaSidebarGroups",
    "PATCH",
    "/admin-meta/sidebar-groups",
    "permission",
    "manage-settings",
    "mutation",
  ],
]);

// ============================================================
// auth — /admin/api/auth/* (public session surface; CSRF on writes)
// ============================================================

const auth = ops("auth", "Auth", [
  ["setup-status", "GET", "/auth/setup-status", "public", undefined, "data"],
  ["session", "GET", "/auth/session", "public", undefined, "data"],
  ["csrf", "GET", "/auth/csrf", "public", undefined, "data"],
  ["ui", "GET", "/auth/ui", "public", undefined, "data"],
  ["login", "POST", "/auth/login", "public", undefined, "data"],
  [
    "challenge-resolve",
    "POST",
    "/auth/challenge/resolve",
    "public",
    undefined,
    "data",
  ],
  ["logout", "POST", "/auth/logout", "public", undefined, "data"],
  ["refresh", "POST", "/auth/refresh", "public", undefined, "data"],
  ["setup", "POST", "/auth/setup", "public", undefined, "data"],
  ["register", "POST", "/auth/register", "public", undefined, "data"],
  [
    "forgot-password",
    "POST",
    "/auth/forgot-password",
    "public",
    undefined,
    "data",
  ],
  [
    "reset-password",
    "POST",
    "/auth/reset-password",
    "public",
    undefined,
    "data",
  ],
  ["accept-invite", "POST", "/auth/accept-invite", "public", undefined, "data"],
  [
    "set-initial-password",
    "POST",
    "/auth/set-initial-password",
    "public",
    undefined,
    "data",
  ],
  ["verify-email", "POST", "/auth/verify-email", "public", undefined, "data"],
  [
    "verify-email-resend",
    "POST",
    "/auth/verify-email/resend",
    "public",
    undefined,
    "data",
  ],
  [
    "change-password",
    "PATCH",
    "/auth/change-password",
    "authenticated",
    undefined,
    "data",
  ],
]);

// ============================================================
// Assembly
// ============================================================

const SERVICE_TABLES: ReadonlyArray<readonly AdminRestOperation[]> = [
  users,
  rbac,
  collections,
  singles,
  forms,
  fieldGroups,
  emailProviders,
  emailTemplates,
  userFields,
  apiKeys,
  webhooks,
  previewLinks,
  generalSettings,
  imageSizes,
  dashboard,
  schema,
  email,
  adminMeta,
  auth,
];

/**
 * Collapse operations that agree on (service, operation, method, path) to the
 * first occurrence — an operation reachable more than one way appears once.
 */
export function dedupeRestOperations(
  operations: readonly AdminRestOperation[]
): AdminRestOperation[] {
  const seen = new Set<string>();
  const out: AdminRestOperation[] = [];
  for (const op of operations) {
    const key = `${op.service}::${op.operation}::${op.method}::${op.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(op);
  }
  return out;
}

/**
 * List every admin REST operation the catch-all exposes. Pure and deterministic
 * so consumers (and tests) can call it freely, and deduped.
 */
export function listAdminRestOperations(): AdminRestOperation[] {
  const all: AdminRestOperation[] = [];
  for (const table of SERVICE_TABLES) all.push(...table);
  return dedupeRestOperations(all);
}

/** Operations for one service, or an empty array if it is not covered. */
export function restOperationsForService(
  service: string
): AdminRestOperation[] {
  return listAdminRestOperations().filter(op => op.service === service);
}
