/**
 * Route Parser Module
 *
 * Handles REST route parsing and mapping to service operations.
 * Extracted from routeHandler.ts for better separation of concerns.
 */

import type { ServiceType, OperationType } from "@nextly/services/dispatcher";

import { parseWhereQuery } from "../services/collections/query-parser";

// ============================================================================
// Types
// ============================================================================

export interface ParsedRoute {
  service?: ServiceType;
  operation?: OperationType;
  method?: string;
  routeParams?: Record<string, string>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map HTTP method to permission action
 */
export function getActionFromMethod(httpMethod: string): string {
  switch (httpMethod) {
    case "GET":
      return "read";
    case "POST":
      return "create";
    case "PATCH":
    case "PUT":
      return "update";
    case "DELETE":
      return "delete";
    default:
      return "read";
  }
}

/**
 * Check if endpoint is public (no auth required)
 */
export function isPublicEndpoint(service: string, method: string): boolean {
  // Public endpoints that don't require authentication
  if (service === "auth") {
    return [
      "register",
      "generatePasswordResetToken",
      "resetPasswordWithToken",
      "verifyEmail",
    ].includes(method);
  }
  // Forms endpoints are public (for form builder submissions)
  if (service === "forms") {
    return true;
  }
  return false;
}

/**
 * Check if endpoint requires auth but no specific permission
 */
export function requiresAuthOnly(service: string, method: string): boolean {
  if (service === "auth") {
    return ["changePassword", "generateEmailVerificationToken"].includes(
      method
    );
  }
  // Collection schema reads: admin UI needs these for sidebar and entry forms.
  // Any authenticated user can read schemas; sidebar filtering handles visibility.
  if (service === "collections" && ["listCollections"].includes(method)) {
    return true;
  }
  // Single schema reads: admin UI needs these for sidebar and content forms.
  if (service === "singles" && ["listSingles"].includes(method)) {
    return true;
  }
  // Component reads: admin UI needs to fetch component details for embedding.
  // Listing is the same class of builder-surface metadata read (the palette
  // needs it), so it requires authentication but no specific permission —
  // matching the collection/single schema-list endpoints above. It must not
  // be public: unauthenticated callers must not enumerate component schemas.
  if (
    service === "field-groups" &&
    ["getComponent", "listComponents"].includes(method)
  ) {
    return true;
  }
  return false;
}

/**
 * The all-locales lifecycle routes, by their URL token.
 *
 * A table rather than a branch per direction. The takedown was built, tested and
 * reachable by nothing for exactly as long as its wiring was a second copy of
 * the publish branch that nobody wrote.
 */
const ALL_LOCALES_ENTRY_ROUTES: Record<string, string> = {
  "publish-all": "publishAllLocales",
  "unpublish-all": "unpublishAllLocales",
};

/**
 * Map parsed route operation to permission action.
 *
 * More reliable than `getActionFromMethod()` for bulk operations where the
 * HTTP method doesn't match the semantic action (e.g., POST for bulk-delete).
 */
export function getActionFromOperation(operation: string): string {
  switch (operation) {
    case "create":
      return "create";
    case "update":
      return "update";
    case "delete":
      return "delete";
    default:
      // "single", "list", "count" → read
      return "read";
  }
}

// ============================================================================
// Route Parsers by Resource
// ============================================================================

function parseMeRoutes(
  httpMethod: string,
  subresource: string | undefined,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // GET /api/me/permissions → get current user's resolved permissions
  if (subresource === "permissions" && httpMethod === "GET") {
    return {
      service: "users",
      operation: "list",
      method: "getCurrentUserPermissions",
      routeParams,
    };
  }

  // Sub-resource routes that don't match above → not found
  if (subresource) {
    return null;
  }

  if (httpMethod === "GET") {
    // GET /api/me → get current user profile
    return {
      service: "users",
      operation: "single",
      method: "getCurrentUser",
      routeParams,
    };
  }

  if (httpMethod === "PATCH") {
    // PATCH /api/me → update current user profile
    return {
      service: "users",
      operation: "update",
      method: "updateCurrentUser",
      routeParams,
    };
  }

  return null;
}

function parseUserRoutes(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  additionalParams: string[],
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (!id && httpMethod === "POST") {
    // POST /api/users → create user
    return {
      service: "users",
      operation: "create",
      method: "createLocalUser",
      routeParams,
    };
  }

  if (!id && httpMethod === "GET") {
    // GET /api/users → list all users
    return {
      service: "users",
      operation: "list",
      method: "listUsers",
      routeParams,
    };
  }

  if (id && !subresource && httpMethod === "GET") {
    // GET /api/users/123 → get user by id
    routeParams.userId = id;
    return {
      service: "users",
      operation: "single",
      method: "getUserById",
      routeParams,
    };
  }

  if (id && !subresource && httpMethod === "PATCH") {
    // PATCH /api/users/123 → update user
    routeParams.userId = id;
    return {
      service: "users",
      operation: "update",
      method: "updateUser",
      routeParams,
    };
  }

  if (id && !subresource && httpMethod === "DELETE") {
    // DELETE /api/users/123 → delete user
    routeParams.userId = id;
    return {
      service: "users",
      operation: "delete",
      method: "deleteUser",
      routeParams,
    };
  }

  if (id && subresource === "password" && httpMethod === "PATCH") {
    // PATCH /api/users/123/password → update password
    routeParams.userId = id;
    return {
      service: "users",
      operation: "update",
      method: "updatePasswordHash",
      routeParams,
    };
  }

  if (id && subresource === "accounts" && !subId && httpMethod === "GET") {
    // GET /api/users/123/accounts → list user accounts
    routeParams.userId = id;
    return {
      service: "users",
      operation: "single",
      method: "getAccounts",
      routeParams,
    };
  }

  if (
    id &&
    subresource === "accounts" &&
    subId &&
    additionalParams[0] &&
    httpMethod === "DELETE"
  ) {
    // DELETE /api/users/123/accounts/github/123456 → unlink account
    routeParams.userId = id;
    routeParams.provider = subId;
    routeParams.providerAccountId = additionalParams[0];
    return {
      service: "users",
      operation: "update",
      method: "unlinkAccountForUser",
      routeParams,
    };
  }

  if (id && subresource === "roles" && !subId && httpMethod === "POST") {
    // POST /api/users/123/roles → assign role to user
    routeParams.userId = id;
    return {
      service: "rbac",
      operation: "update",
      method: "assignRoleToUser",
      routeParams,
    };
  }

  if (id && subresource === "roles" && !subId && httpMethod === "GET") {
    // GET /api/users/123/roles → list user roles
    routeParams.userId = id;
    return {
      service: "rbac",
      operation: "list",
      method: "listUserRoles",
      routeParams,
    };
  }

  if (id && subresource === "roles" && subId && httpMethod === "DELETE") {
    // DELETE /api/users/123/roles/456 → unassign role from user
    routeParams.userId = id;
    routeParams.roleId = subId;
    return {
      service: "rbac",
      operation: "update",
      method: "unassignRoleFromUser",
      routeParams,
    };
  }

  return null;
}

function parseRoleRoutes(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (!id && httpMethod === "POST") {
    // POST /api/roles → create role
    return {
      service: "rbac",
      operation: "create",
      method: "createRole",
      routeParams,
    };
  }

  if (!id && httpMethod === "GET") {
    // GET /api/roles → list all roles
    return {
      service: "rbac",
      operation: "list",
      method: "listRoles",
      routeParams,
    };
  }

  if (id && !subresource && httpMethod === "GET") {
    // GET /api/roles/123 → get role by id
    routeParams.roleId = id;
    return {
      service: "rbac",
      operation: "single",
      method: "getRoleById",
      routeParams,
    };
  }

  if (id && !subresource && httpMethod === "PATCH") {
    // PATCH /api/roles/123 → update role
    routeParams.roleId = id;
    return {
      service: "rbac",
      operation: "update",
      method: "updateRole",
      routeParams,
    };
  }

  if (id && !subresource && httpMethod === "DELETE") {
    // DELETE /api/roles/123 → delete role
    routeParams.roleId = id;
    return {
      service: "rbac",
      operation: "delete",
      method: "deleteRole",
      routeParams,
    };
  }

  if (id && subresource === "children" && !subId && httpMethod === "POST") {
    // POST /api/roles/123/children → add child role (role inheritance)
    routeParams.parentRoleId = id;
    return {
      service: "rbac",
      operation: "update",
      method: "addRoleInheritance",
      routeParams,
    };
  }

  if (id && subresource === "children" && !subId && httpMethod === "GET") {
    // GET /api/roles/123/children → list child roles
    routeParams.roleId = id;
    return {
      service: "rbac",
      operation: "list",
      method: "listDescendantRoles",
      routeParams,
    };
  }

  if (id && subresource === "children" && subId && httpMethod === "DELETE") {
    // DELETE /api/roles/123/children/456 → remove child role
    routeParams.parentRoleId = id;
    routeParams.childRoleId = subId;
    return {
      service: "rbac",
      operation: "update",
      method: "removeRoleInheritance",
      routeParams,
    };
  }

  if (id && subresource === "parents" && httpMethod === "GET") {
    // GET /api/roles/123/parents → list parent roles
    routeParams.roleId = id;
    return {
      service: "rbac",
      operation: "list",
      method: "listAncestorRoles",
      routeParams,
    };
  }

  if (id && subresource === "permissions" && !subId && httpMethod === "PATCH") {
    // PATCH /api/roles/123/permissions → bulk-set (replace) all permissions for role
    // Body: { permissionIds: string[] } — the complete desired set
    routeParams.roleId = id;
    return {
      service: "rbac",
      operation: "update",
      method: "setRolePermissions",
      routeParams,
    };
  }

  if (id && subresource === "permissions" && !subId && httpMethod === "POST") {
    // POST /api/roles/123/permissions → add permission to role
    routeParams.roleId = id;
    return {
      service: "rbac",
      operation: "update",
      method: "addPermissionToRole",
      routeParams,
    };
  }

  if (id && subresource === "permissions" && !subId && httpMethod === "GET") {
    // GET /api/roles/123/permissions → list role permissions
    routeParams.roleId = id;
    return {
      service: "rbac",
      operation: "list",
      method: "listRolePermissions",
      routeParams,
    };
  }

  if (id && subresource === "permissions" && subId && httpMethod === "DELETE") {
    // DELETE /api/roles/123/permissions/456 → remove permission from role
    routeParams.roleId = id;
    routeParams.permissionId = subId;
    return {
      service: "rbac",
      operation: "update",
      method: "removePermissionFromRole",
      routeParams,
    };
  }

  return null;
}

function parseCollectionRoutes(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>,
  additionalParams: string[] = []
): ParsedRoute | null {
  // Check for bulk operations first (more specific routes)
  const bulkDeleteRoute = parseCollectionEntryBulkDeleteRoute(
    id,
    subresource,
    subId,
    httpMethod,
    routeParams
  );
  if (bulkDeleteRoute) return bulkDeleteRoute;

  const bulkUpdateRoute = parseCollectionEntryBulkUpdateRoute(
    id,
    subresource,
    subId,
    httpMethod,
    routeParams
  );
  if (bulkUpdateRoute) return bulkUpdateRoute;

  const bulkUpdateByQueryRoute = parseCollectionEntryBulkUpdateByQueryRoute(
    id,
    subresource,
    subId,
    httpMethod,
    routeParams
  );
  if (bulkUpdateByQueryRoute) return bulkUpdateByQueryRoute;

  // Check for duplicate route (more specific)
  const duplicateRoute = parseCollectionEntryDuplicateRoute(
    id,
    subresource,
    subId,
    additionalParams,
    httpMethod,
    routeParams
  );
  if (duplicateRoute) return duplicateRoute;

  // i18n M7: publish-all-languages route (more specific than getEntry/updateEntry)
  const publishAllRoute = parseCollectionEntryPublishAllRoute(
    id,
    subresource,
    subId,
    additionalParams,
    httpMethod,
    routeParams
  );
  if (publishAllRoute) return publishAllRoute;

  // Check for count route (more specific than getEntry)
  const countRoute = parseCollectionEntryCountRoute(
    id,
    subresource,
    subId,
    httpMethod,
    routeParams
  );
  if (countRoute) return countRoute;

  if (!id && httpMethod === "POST") {
    // POST /api/collections → create collection
    return {
      service: "collections",
      operation: "create",
      method: "createCollection",
      routeParams,
    };
  }

  if (!id && httpMethod === "GET") {
    // GET /api/collections → list all collections
    return {
      service: "collections",
      operation: "list",
      method: "listCollections",
      routeParams,
    };
  }

  // POST /api/collections/schema/{slug}/preview → preview schema changes (dry-run diff)
  if (
    id === "schema" &&
    subresource &&
    subId === "preview" &&
    httpMethod === "POST"
  ) {
    routeParams.collectionName = subresource;
    return {
      service: "collections",
      operation: "single",
      method: "previewSchemaChanges",
      routeParams,
    };
  }

  // POST /api/collections/schema/{slug}/apply → apply confirmed schema changes
  if (
    id === "schema" &&
    subresource &&
    subId === "apply" &&
    httpMethod === "POST"
  ) {
    routeParams.collectionName = subresource;
    return {
      service: "collections",
      operation: "update",
      method: "applySchemaChanges",
      routeParams,
    };
  }

  if (id === "schema" && subresource && httpMethod === "GET") {
    // GET /api/collections/schema/course → get collection schema with enriched component fields
    routeParams.collectionName = subresource;
    return {
      service: "collections",
      operation: "single",
      method: "getCollection",
      routeParams,
    };
  }

  if (id && !subresource && httpMethod === "GET") {
    // GET /api/collections/products → get collection by name
    routeParams.collectionName = id;
    return {
      service: "collections",
      operation: "single",
      method: "getCollection",
      routeParams,
    };
  }

  if (id && !subresource && httpMethod === "PATCH") {
    // PATCH /api/collections/products → update collection
    routeParams.collectionName = id;
    return {
      service: "collections",
      operation: "update",
      method: "updateCollection",
      routeParams,
    };
  }

  if (id && !subresource && httpMethod === "DELETE") {
    // DELETE /api/collections/products → delete collection
    routeParams.collectionName = id;
    return {
      service: "collections",
      operation: "delete",
      method: "deleteCollection",
      routeParams,
    };
  }

  if (id && subresource === "entries" && !subId && httpMethod === "GET") {
    // GET /api/collections/products/entries → list entries
    routeParams.collectionName = id;
    return {
      service: "collections",
      operation: "list",
      method: "listEntries",
      routeParams,
    };
  }

  if (id && subresource === "entries" && !subId && httpMethod === "POST") {
    // POST /api/collections/products/entries → create entry
    routeParams.collectionName = id;
    return {
      service: "collections",
      operation: "create",
      method: "createEntry",
      routeParams,
    };
  }

  // The three branches below match the entry itself, so they must not claim a
  // path that carries further segments. Every real sub-route (duplicate,
  // publish-all, count, bulk, versions) is matched earlier, so anything still
  // trailing here belongs to no route: without this guard
  // `DELETE /entries/{id}/versions` would silently delete the entry.
  const targetsEntryItself = additionalParams.length === 0;

  if (
    id &&
    subresource === "entries" &&
    subId &&
    targetsEntryItself &&
    httpMethod === "GET"
  ) {
    // GET /api/collections/products/entries/123 → get entry by id
    routeParams.collectionName = id;
    routeParams.entryId = subId;
    return {
      service: "collections",
      operation: "single",
      method: "getEntry",
      routeParams,
    };
  }

  if (
    id &&
    subresource === "entries" &&
    subId &&
    targetsEntryItself &&
    httpMethod === "PATCH"
  ) {
    // PATCH /api/collections/products/entries/123 → update entry
    routeParams.collectionName = id;
    routeParams.entryId = subId;
    return {
      service: "collections",
      operation: "update",
      method: "updateEntry",
      routeParams,
    };
  }

  if (
    id &&
    subresource === "entries" &&
    subId &&
    targetsEntryItself &&
    httpMethod === "DELETE"
  ) {
    // DELETE /api/collections/products/entries/123 → delete entry
    routeParams.collectionName = id;
    routeParams.entryId = subId;
    return {
      service: "collections",
      operation: "delete",
      method: "deleteEntry",
      routeParams,
    };
  }

  return null;
}

function parseCollectionEntryDuplicateRoute(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  additionalParams: string[],
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (
    id &&
    subresource === "entries" &&
    subId &&
    additionalParams[0] === "duplicate" &&
    httpMethod === "POST"
  ) {
    // POST /api/collections/products/entries/123/duplicate → duplicate entry
    routeParams.collectionName = id;
    routeParams.entryId = subId;
    return {
      service: "collections",
      operation: "create",
      method: "duplicateEntry",
      routeParams,
    };
  }

  return null;
}

/**
 * Parse the publish-all-languages route for a collection entry (i18n M7).
 * POST /api/collections/{slug}/entries/{id}/publish-all
 */
function parseCollectionEntryPublishAllRoute(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  additionalParams: string[],
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // Both directions of the all-locales lifecycle, as a lookup rather than two
  // branches. They differ only in the token and the method it names, and stating
  // that difference twice is how a route and its twin start to disagree about
  // the shape they both match.
  const allLocales = ALL_LOCALES_ENTRY_ROUTES[additionalParams[0] ?? ""];
  if (
    id &&
    subresource === "entries" &&
    subId &&
    allLocales &&
    httpMethod === "POST"
  ) {
    routeParams.collectionName = id;
    routeParams.entryId = subId;
    return {
      service: "collections",
      // Authorized as an `update` in BOTH directions: no route-level gate can
      // express publish or unpublish, so the service judges a scoped key's own
      // grant on top of this. Giving either its own operation would invent a
      // permission name nothing seeds.
      operation: "update",
      method: allLocales,
      routeParams,
    };
  }

  return null;
}

/**
 * Parse bulk delete route for collection entries
 * POST /api/collections/{slug}/entries/bulk-delete
 */
/**
 * `/collections/{slug}/entries/{entryId}/versions[/{versionNo}]`
 *
 * Version history nests under its entry so the existing `read-{slug}`
 * permission that guards the document guards its history too, with no separate
 * authorization branch.
 */
function parseCollectionEntryVersionRoutes(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  additionalParams: string[],
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (
    !id ||
    subresource !== "entries" ||
    !subId ||
    additionalParams[0] !== "versions"
  ) {
    return null;
  }

  // `versions/{versionNo}/restore` is a write, and the only path here deeper
  // than a version number.
  if (
    additionalParams.length === 3 &&
    additionalParams[2] === "restore" &&
    httpMethod === "POST"
  ) {
    routeParams.collectionName = id;
    routeParams.entryId = subId;
    routeParams.versionNo = additionalParams[1] ?? "";
    return {
      service: "collections",
      // Restoring writes the document, so it is authorized as an update rather
      // than as a read of its history.
      operation: "update",
      method: "restoreEntryVersion",
      routeParams,
    };
  }

  // Naming a version edits history rather than the document, but it is still a
  // write, so it is authorized as one. PATCH because it is idempotent: sending
  // the same label twice leaves the same state.
  if (additionalParams.length === 2 && httpMethod === "PATCH") {
    routeParams.collectionName = id;
    routeParams.entryId = subId;
    routeParams.versionNo = additionalParams[1] ?? "";
    return {
      service: "collections",
      operation: "update",
      method: "setEntryVersionLabel",
      routeParams,
    };
  }

  // `versions/working-draft` DELETE discards the pending working draft
  // (draft/published split), reverting the document to its live published row.
  // `working-draft` is a named sub-resource, never a version number, so it can
  // never collide with `versions/{versionNo}`. Authorized as an update: it
  // changes what the editor sees, not the document's history.
  if (
    additionalParams.length === 2 &&
    additionalParams[1] === "working-draft" &&
    httpMethod === "DELETE"
  ) {
    routeParams.collectionName = id;
    routeParams.entryId = subId;
    return {
      service: "collections",
      operation: "update",
      method: "discardWorkingDraft",
      routeParams,
    };
  }

  // `versions/autosave` PUT records the author's rolling recovery point.
  // `autosave` is a named sub-resource and a version number is always numeric,
  // so the two can never collide.
  //
  // PUT rather than POST because it is idempotent by construction: there is one
  // autosave row per document and author, rewritten in place, so repeating the
  // request leaves the same single row rather than accumulating them.
  //
  // Authorized as an UPDATE of the entry. A recovery point holds the same
  // content the entry does, so anyone who may not change the entry must not be
  // able to store its contents, and anyone editing it already holds this.
  if (
    additionalParams.length === 2 &&
    additionalParams[1] === "autosave" &&
    httpMethod === "PUT"
  ) {
    routeParams.collectionName = id;
    routeParams.entryId = subId;
    return {
      service: "collections",
      operation: "update",
      method: "autosaveEntry",
      routeParams,
    };
  }

  // The matching read. Claimed here rather than left to the generic version
  // read below, which would take `autosave` as a version NUMBER and answer a
  // validation error for a path that has a real handler. Authorized as a read:
  // it returns the caller's own recovery point and nothing else.
  if (
    additionalParams.length === 2 &&
    additionalParams[1] === "autosave" &&
    httpMethod === "GET"
  ) {
    routeParams.collectionName = id;
    routeParams.entryId = subId;
    return {
      service: "collections",
      operation: "single",
      method: "getEntryAutosave",
      routeParams,
    };
  }

  if (
    // Only `versions` or `versions/{versionNo}`; anything deeper is not a
    // route this owns and must not be silently truncated to one that is.
    additionalParams.length > 2 ||
    httpMethod !== "GET"
  ) {
    return null;
  }

  routeParams.collectionName = id;
  routeParams.entryId = subId;

  // `versions/diff?from=A&to=B` compares two versions. It is a read of history,
  // authorized like reading a single version; `diff` can never collide with a
  // version number, which is always numeric.
  if (additionalParams[1] === "diff") {
    return {
      service: "collections",
      operation: "single",
      method: "getEntryVersionDiff",
      routeParams,
    };
  }

  const versionNo = additionalParams[1];
  if (versionNo) {
    routeParams.versionNo = versionNo;
    return {
      service: "collections",
      operation: "single",
      method: "getEntryVersion",
      routeParams,
    };
  }

  return {
    service: "collections",
    operation: "list",
    method: "listEntryVersions",
    routeParams,
  };
}

/**
 * `/singles/{slug}/versions[/{versionNo}]` — the Single equivalent, nesting
 * under the document for the same reason.
 */
/**
 * Named sub-resources under a Single's `versions`, keyed by `"{name} {METHOD}"`.
 *
 * A table rather than a branch each: every one of these tests the same three
 * things and returns a fixed descriptor, so a branch per entry is decision
 * points spent restating a shape.
 *
 * A `Map` rather than an object literal because the key is built from a URL
 * segment: a lookup on an object would reach inherited members, so a request for
 * `versions/constructor` would find one.
 *
 * `autosave` is PUT because the row is rolling — one per document and author,
 * rewritten in place — so repeating the request leaves one recovery point.
 * `working-draft` is DELETE of the pending change, authorized as an update
 * because it changes what the editor sees rather than the document's history.
 */
const SINGLE_VERSION_SUBRESOURCES = new Map<
  string,
  { operation: OperationType; method: string }
>([
  ["autosave PUT", { operation: "update", method: "autosaveSingle" }],
  ["autosave GET", { operation: "single", method: "getSingleAutosave" }],
  [
    "working-draft DELETE",
    { operation: "update", method: "discardSingleWorkingDraft" },
  ],
]);

function parseSingleVersionRoutes(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  additionalParams: string[],
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (!id || subresource !== "versions") {
    return null;
  }

  // `versions/{versionNo}/restore` is a write, and the only path here deeper
  // than a version number.
  if (
    subId &&
    additionalParams.length === 1 &&
    additionalParams[0] === "restore" &&
    httpMethod === "POST"
  ) {
    routeParams.slug = id;
    routeParams.versionNo = subId;
    return {
      service: "singles",
      // Restoring writes the document, so it is authorized as an update.
      operation: "update",
      method: "restoreSingleVersion",
      routeParams,
    };
  }

  // The named sub-resources of a Single's history, matched from the table above
  // rather than as one `if` each. A Single's history nests directly under the
  // document, so these arrive as `subId` where the collection parser sees them
  // in `additionalParams`; a version number is always numeric, so a name can
  // never collide with one.
  if (subId !== undefined && additionalParams.length === 0) {
    const named = SINGLE_VERSION_SUBRESOURCES.get(
      `${subId} ${httpMethod.toUpperCase()}`
    );
    if (named) {
      routeParams.slug = id;
      return { service: "singles", ...named, routeParams };
    }
  }

  // See the collection parser: naming a version is an idempotent write on
  // history, authorized as an update.
  if (subId && additionalParams.length === 0 && httpMethod === "PATCH") {
    routeParams.slug = id;
    routeParams.versionNo = subId;
    return {
      service: "singles",
      operation: "update",
      method: "setSingleVersionLabel",
      routeParams,
    };
  }

  if (
    // Only `versions` or `versions/{versionNo}`; a deeper path is not ours.
    additionalParams.length > 0 ||
    httpMethod !== "GET"
  ) {
    return null;
  }

  routeParams.slug = id;

  // `versions/diff?from=A&to=B` compares two versions; a read of history like
  // reading one version. `diff` cannot collide with a numeric version number.
  if (subId === "diff") {
    return {
      service: "singles",
      operation: "single",
      method: "getSingleVersionDiff",
      routeParams,
    };
  }

  if (subId) {
    routeParams.versionNo = subId;
    return {
      service: "singles",
      operation: "single",
      method: "getSingleVersion",
      routeParams,
    };
  }

  return {
    service: "singles",
    operation: "list",
    method: "listSingleVersions",
    routeParams,
  };
}

function parseCollectionEntryBulkDeleteRoute(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (
    id &&
    subresource === "entries" &&
    subId === "bulk-delete" &&
    httpMethod === "POST"
  ) {
    // POST /api/collections/products/entries/bulk-delete → bulk delete entries
    routeParams.collectionName = id;
    return {
      service: "collections",
      operation: "delete",
      method: "bulkDeleteEntries",
      routeParams,
    };
  }

  return null;
}

/**
 * Parse bulk update route for collection entries
 * POST /api/collections/{slug}/entries/bulk-update
 */
function parseCollectionEntryBulkUpdateRoute(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (
    id &&
    subresource === "entries" &&
    subId === "bulk-update" &&
    httpMethod === "POST"
  ) {
    // POST /api/collections/products/entries/bulk-update → bulk update entries
    routeParams.collectionName = id;
    return {
      service: "collections",
      operation: "update",
      method: "bulkUpdateEntries",
      routeParams,
    };
  }

  return null;
}

/**
 * Parse bulk update by query route for collection entries
 * PATCH /api/collections/{slug}/entries (with where clause in body)
 *
 * This is different from bulk-update which uses POST with IDs.
 * This endpoint accepts a where clause in the body to update
 * all matching entries.
 */
function parseCollectionEntryBulkUpdateByQueryRoute(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (id && subresource === "entries" && !subId && httpMethod === "PATCH") {
    // PATCH /api/collections/products/entries → bulk update by query
    routeParams.collectionName = id;
    return {
      service: "collections",
      operation: "update",
      method: "bulkUpdateByQuery",
      routeParams,
    };
  }

  return null;
}

/**
 * Parse count route for collection entries
 * GET /api/collections/{slug}/entries/count
 */
function parseCollectionEntryCountRoute(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (
    id &&
    subresource === "entries" &&
    subId === "count" &&
    httpMethod === "GET"
  ) {
    // GET /api/collections/products/entries/count → count entries
    routeParams.collectionName = id;
    return {
      service: "collections",
      operation: "count",
      method: "countEntries",
      routeParams,
    };
  }

  return null;
}

function parsePermissionRoutes(
  id: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (!id && httpMethod === "POST") {
    // POST /api/permissions → create permission
    return {
      service: "rbac",
      operation: "create",
      method: "ensurePermission",
      routeParams,
    };
  }

  if (!id && httpMethod === "GET") {
    // GET /api/permissions → list permissions
    return {
      service: "rbac",
      operation: "list",
      method: "listPermissions",
      routeParams,
    };
  }

  if (id && httpMethod === "GET") {
    // GET /api/permissions/123 → get permission by id
    routeParams.permissionId = id;
    return {
      service: "rbac",
      operation: "single",
      method: "getPermissionById",
      routeParams,
    };
  }

  if (id && httpMethod === "PATCH") {
    // PATCH /api/permissions/123 → update permission
    routeParams.permissionId = id;
    return {
      service: "rbac",
      operation: "update",
      method: "updatePermission",
      routeParams,
    };
  }

  if (id && httpMethod === "DELETE") {
    // DELETE /api/permissions/123 → delete permission by id
    routeParams.permissionId = id;
    return {
      service: "rbac",
      operation: "delete",
      method: "deletePermissionById",
      routeParams,
    };
  }

  return null;
}

function parseSingleRoutes(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // GET /api/singles → list all Singles
  if (!id && httpMethod === "GET") {
    return {
      service: "singles",
      operation: "list",
      method: "listSingles",
      routeParams,
    };
  }

  // POST /api/singles → create new Single (Schema Builder)
  if (!id && httpMethod === "POST") {
    return {
      service: "singles",
      operation: "create",
      method: "createSingle",
      routeParams,
    };
  }

  // GET /api/singles/[slug] → get Single document
  if (id && !subresource && httpMethod === "GET") {
    routeParams.slug = id;
    return {
      service: "singles",
      operation: "single",
      method: "getSingleDocument",
      routeParams,
    };
  }

  // PATCH /api/singles/[slug] → update Single document
  if (id && !subresource && httpMethod === "PATCH") {
    routeParams.slug = id;
    return {
      service: "singles",
      operation: "update",
      method: "updateSingleDocument",
      routeParams,
    };
  }

  // DELETE /api/singles/[slug] → delete Single (UI-created only)
  if (id && !subresource && httpMethod === "DELETE") {
    routeParams.slug = id;
    return {
      service: "singles",
      operation: "delete",
      method: "deleteSingle",
      routeParams,
    };
  }

  // POST /api/singles/[slug]/publish-all → publish every language at once.
  // Authorized as an `update` like the collection entry equivalent: the route
  // gate cannot express `publish`, so the service checks `publish-{slug}` for
  // itself on top of the update the route authorized.
  if (id && subresource === "publish-all" && !subId && httpMethod === "POST") {
    routeParams.slug = id;
    return {
      service: "singles",
      operation: "update",
      method: "publishAllSingleLocales",
      routeParams,
    };
  }

  // GET /api/singles/[slug]/schema → get Single schema/metadata
  if (id && subresource === "schema" && httpMethod === "GET") {
    routeParams.slug = id;
    return {
      service: "singles",
      operation: "single",
      method: "getSingleSchema",
      routeParams,
    };
  }

  // PATCH /api/singles/[slug]/schema → update Single schema (Schema Builder)
  if (id && subresource === "schema" && httpMethod === "PATCH") {
    routeParams.slug = id;
    return {
      service: "singles",
      operation: "update",
      method: "updateSingleSchema",
      routeParams,
    };
  }

  // POST /api/singles/schema/[slug]/preview → preview single schema changes (dry-run diff)
  if (
    id === "schema" &&
    subresource &&
    subId === "preview" &&
    httpMethod === "POST"
  ) {
    routeParams.slug = subresource;
    return {
      service: "singles",
      operation: "single",
      method: "previewSingleSchemaChanges",
      routeParams,
    };
  }

  // POST /api/singles/schema/[slug]/apply → apply confirmed single schema changes
  if (
    id === "schema" &&
    subresource &&
    subId === "apply" &&
    httpMethod === "POST"
  ) {
    routeParams.slug = subresource;
    return {
      service: "singles",
      operation: "update",
      method: "applySingleSchemaChanges",
      routeParams,
    };
  }

  return null;
}

// ============================================================================
// Components Routes Parser
// ============================================================================

/**
 * Parse Components routes
 *
 * Handles component definition endpoints:
 * - GET /api/field-groups → list all components
 * - POST /api/field-groups → create component (Schema Builder)
 * - GET /api/field-groups/[slug] → get component by slug
 * - PATCH /api/field-groups/[slug] → update component
 * - DELETE /api/field-groups/[slug] → delete component
 * - POST /api/field-groups/schema/[slug]/preview → preview component schema changes
 * - POST /api/field-groups/schema/[slug]/apply → apply confirmed component schema changes
 */
function parseComponentRoutes(
  id: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>,
  subresource?: string,
  subId?: string
): ParsedRoute | null {
  // POST /api/field-groups/schema/[slug]/preview → preview component schema changes
  if (
    id === "schema" &&
    subresource &&
    subId === "preview" &&
    httpMethod === "POST"
  ) {
    routeParams.slug = subresource;
    return {
      service: "field-groups",
      operation: "single",
      method: "previewComponentSchemaChanges",
      routeParams,
    };
  }

  // POST /api/field-groups/schema/[slug]/apply → apply confirmed component schema changes
  if (
    id === "schema" &&
    subresource &&
    subId === "apply" &&
    httpMethod === "POST"
  ) {
    routeParams.slug = subresource;
    return {
      service: "field-groups",
      operation: "update",
      method: "applyComponentSchemaChanges",
      routeParams,
    };
  }

  // GET /api/field-groups/schema/[slug]/reconcile → what that repair WOULD change, changing
  // nothing. The same path as the repair below, separated by verb: GET asks, POST does.
  //
  // Classified as `update` rather than the `read` its verb implies, and the override in
  // `routeHandler` is what enforces that. The plan names live columns and the drift between them
  // and the stored definition, which is not something a principal who may only read definitions
  // should be able to enumerate — and nobody who cannot perform the repair needs to preview it.
  if (
    id === "schema" &&
    subresource &&
    subId === "reconcile" &&
    httpMethod === "GET"
  ) {
    routeParams.slug = subresource;
    return {
      service: "field-groups",
      operation: "single",
      method: "previewComponentReconcile",
      routeParams,
    };
  }

  // POST /api/field-groups/schema/[slug]/reconcile → repair the stored definition to describe the
  // live tables. Classified as `update`: it writes the registry row, so it takes the same
  // authorization as the other definition writes — a reader must not be able to rewrite a
  // definition by way of repairing it.
  if (
    id === "schema" &&
    subresource &&
    subId === "reconcile" &&
    httpMethod === "POST"
  ) {
    routeParams.slug = subresource;
    return {
      service: "field-groups",
      operation: "update",
      method: "reconcileComponent",
      routeParams,
    };
  }

  const slug = id;

  // GET /api/field-groups → list all components
  if (!slug && httpMethod === "GET") {
    return {
      service: "field-groups",
      operation: "list",
      method: "listComponents",
      routeParams,
    };
  }

  // POST /api/field-groups → create component (Schema Builder)
  if (!slug && httpMethod === "POST") {
    return {
      service: "field-groups",
      operation: "create",
      method: "createComponent",
      routeParams,
    };
  }

  // GET /api/field-groups/[slug] → get component by slug
  if (slug && httpMethod === "GET") {
    routeParams.slug = slug;
    return {
      service: "field-groups",
      operation: "single",
      method: "getComponent",
      routeParams,
    };
  }

  // PATCH /api/field-groups/[slug] → update component
  if (slug && httpMethod === "PATCH") {
    routeParams.slug = slug;
    return {
      service: "field-groups",
      operation: "update",
      method: "updateComponent",
      routeParams,
    };
  }

  // DELETE /api/field-groups/[slug] → delete component
  if (slug && httpMethod === "DELETE") {
    routeParams.slug = slug;
    return {
      service: "field-groups",
      operation: "delete",
      method: "deleteComponent",
      routeParams,
    };
  }

  return null;
}

// ============================================================================
// Forms Routes Parser
// ============================================================================

/**
 * Parse Forms routes
 *
 * Handles public form endpoints for form builder plugin:
 * - GET /api/forms → list published forms
 * - GET /api/forms/[slug] → get form by slug
 * - POST /api/forms/[slug]/submit → submit form
 */
function parseFormsRoutes(
  slug: string | undefined,
  action: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // GET /api/forms → list published forms
  if (!slug && httpMethod === "GET") {
    return {
      service: "forms",
      operation: "list",
      method: "listForms",
      routeParams,
    };
  }

  // GET /api/forms/[slug] → get form by slug
  if (slug && !action && httpMethod === "GET") {
    routeParams.slug = slug;
    return {
      service: "forms",
      operation: "single",
      method: "getFormBySlug",
      routeParams,
    };
  }

  // POST /api/forms/[slug]/submit → submit form
  if (slug && action === "submit" && httpMethod === "POST") {
    routeParams.slug = slug;
    return {
      service: "forms",
      operation: "create",
      method: "submitForm",
      routeParams,
    };
  }

  return null;
}

// ============================================================================
// Email Provider Routes Parser
// ============================================================================

/**
 * Parse Email Provider routes
 *
 * Handles email provider management endpoints:
 * - GET /api/email-providers → list all providers
 * - POST /api/email-providers → create provider
 * - GET /api/email-providers/[id] → get provider by id
 * - PATCH /api/email-providers/[id] → update provider
 * - DELETE /api/email-providers/[id] → delete provider
 * - PATCH /api/email-providers/[id]/default → set as default
 * - GET /api/email-providers/types → registered provider catalog
 * - POST /api/email-providers/[id]/test → send test email
 */
function parseEmailProviderRoutes(
  id: string | undefined,
  subresource: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // GET /api/email-providers/types → the registered provider catalog.
  // Matched BEFORE the by-id branch, which would otherwise read "types" as a
  // provider id and answer 404 for a route that has nothing to do with one.
  if (id === "types" && !subresource && httpMethod === "GET") {
    return {
      service: "emailProviders",
      operation: "list",
      method: "listProviderTypes",
      routeParams,
    };
  }

  // GET /api/email-providers → list all providers
  if (!id && httpMethod === "GET") {
    return {
      service: "emailProviders",
      operation: "list",
      method: "listProviders",
      routeParams,
    };
  }

  // POST /api/email-providers → create provider
  if (!id && httpMethod === "POST") {
    return {
      service: "emailProviders",
      operation: "create",
      method: "createProvider",
      routeParams,
    };
  }

  // PATCH /api/email-providers/[id]/default → set as default provider
  if (id && subresource === "default" && httpMethod === "PATCH") {
    routeParams.providerId = id;
    return {
      service: "emailProviders",
      operation: "update",
      method: "setDefault",
      routeParams,
    };
  }

  // POST /api/email-providers/[id]/test → send test email
  if (id && subresource === "test" && httpMethod === "POST") {
    routeParams.providerId = id;
    return {
      service: "emailProviders",
      operation: "single",
      method: "testProvider",
      routeParams,
    };
  }

  // GET /api/email-providers/[id] → get provider by id
  if (id && !subresource && httpMethod === "GET") {
    routeParams.providerId = id;
    return {
      service: "emailProviders",
      operation: "single",
      method: "getProvider",
      routeParams,
    };
  }

  // PATCH /api/email-providers/[id] → update provider
  if (id && !subresource && httpMethod === "PATCH") {
    routeParams.providerId = id;
    return {
      service: "emailProviders",
      operation: "update",
      method: "updateProvider",
      routeParams,
    };
  }

  // DELETE /api/email-providers/[id] → delete provider
  if (id && !subresource && httpMethod === "DELETE") {
    routeParams.providerId = id;
    return {
      service: "emailProviders",
      operation: "delete",
      method: "deleteProvider",
      routeParams,
    };
  }

  return null;
}

// ============================================================================
// Email Template Routes Parser
// ============================================================================

/**
 * Parse Email Template routes
 *
 * Handles email template management endpoints:
 * - GET /api/email-templates → list all templates
 * - POST /api/email-templates → create template
 * - GET /api/email-templates/layout → get shared layout (header/footer)
 * - PATCH /api/email-templates/layout → update shared layout
 * - GET /api/email-templates/[id] → get template by id
 * - PATCH /api/email-templates/[id] → update template
 * - DELETE /api/email-templates/[id] → delete template
 * - POST /api/email-templates/preview → render unsaved fields (draft)
 * - POST /api/email-templates/[id]/preview → preview with sample data
 */
function parseEmailTemplateRoutes(
  id: string | undefined,
  subresource: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // GET /api/email-templates → list all templates
  if (!id && httpMethod === "GET") {
    return {
      service: "emailTemplates",
      operation: "list",
      method: "listTemplates",
      routeParams,
    };
  }

  // POST /api/email-templates → create template
  if (!id && httpMethod === "POST") {
    return {
      service: "emailTemplates",
      operation: "create",
      method: "createTemplate",
      routeParams,
    };
  }

  // POST /api/email-templates/preview → render UNSAVED fields
  //
  // Ahead of every `[id]` branch because this segment is a ROUTE, not an id.
  // Read as an id it matches no POST operation at all, so the mounted admin's
  // live preview answered not-found on every keystroke while the standalone
  // route module worked in isolation — the catch-all is what a generated app
  // actually mounts.
  //
  // `single` matches its id-addressed sibling below: both are non-CRUD reads
  // returning one rendered artifact. The operation does not select the
  // permission here — that comes from the HTTP method — so POST resolves to
  // create-or-manage on email-templates either way.
  if (id === "preview" && !subresource && httpMethod === "POST") {
    return {
      service: "emailTemplates",
      operation: "single",
      method: "previewDraft",
      routeParams,
    };
  }

  // POST /api/email-templates/[id]/preview → preview with sample data
  if (id && subresource === "preview" && httpMethod === "POST") {
    routeParams.templateId = id;
    return {
      service: "emailTemplates",
      operation: "single",
      method: "previewTemplate",
      routeParams,
    };
  }

  // GET /api/email-templates/[id] → get template by id
  if (id && !subresource && httpMethod === "GET") {
    routeParams.templateId = id;
    return {
      service: "emailTemplates",
      operation: "single",
      method: "getTemplate",
      routeParams,
    };
  }

  // PATCH /api/email-templates/[id] → update template
  if (id && !subresource && httpMethod === "PATCH") {
    routeParams.templateId = id;
    return {
      service: "emailTemplates",
      operation: "update",
      method: "updateTemplate",
      routeParams,
    };
  }

  // DELETE /api/email-templates/[id] → delete template
  if (id && !subresource && httpMethod === "DELETE") {
    routeParams.templateId = id;
    return {
      service: "emailTemplates",
      operation: "delete",
      method: "deleteTemplate",
      routeParams,
    };
  }

  return null;
}

// ============================================================================
// User Field Routes Parser
// ============================================================================

/**
 * Parse User Field Definition routes
 *
 * Handles custom user field definition management endpoints:
 * - GET /api/user-fields → list all field definitions (merged code + UI)
 * - POST /api/user-fields → create field definition
 * - PATCH /api/user-fields/reorder → reorder field definitions
 * - GET /api/user-fields/[id] → get field definition by id
 * - PATCH /api/user-fields/[id] → update field definition
 * - DELETE /api/user-fields/[id] → delete field definition
 */
function parseUserFieldRoutes(
  id: string | undefined,
  subresource: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // GET /api/user-fields → list all field definitions
  if (!id && httpMethod === "GET") {
    return {
      service: "userFields",
      operation: "list",
      method: "listUserFields",
      routeParams,
    };
  }

  // POST /api/user-fields → create field definition
  if (!id && httpMethod === "POST") {
    return {
      service: "userFields",
      operation: "create",
      method: "createField",
      routeParams,
    };
  }

  // PATCH /api/user-fields/reorder → reorder field definitions
  if (id === "reorder" && !subresource && httpMethod === "PATCH") {
    return {
      service: "userFields",
      operation: "update",
      method: "reorderFields",
      routeParams,
    };
  }

  // GET /api/user-fields/[id] → get field definition by id
  if (id && !subresource && httpMethod === "GET") {
    routeParams.fieldId = id;
    return {
      service: "userFields",
      operation: "single",
      method: "getField",
      routeParams,
    };
  }

  // PATCH /api/user-fields/[id] → update field definition
  if (id && !subresource && httpMethod === "PATCH") {
    routeParams.fieldId = id;
    return {
      service: "userFields",
      operation: "update",
      method: "updateField",
      routeParams,
    };
  }

  // DELETE /api/user-fields/[id] → delete field definition
  if (id && !subresource && httpMethod === "DELETE") {
    routeParams.fieldId = id;
    return {
      service: "userFields",
      operation: "delete",
      method: "deleteField",
      routeParams,
    };
  }

  return null;
}

/**
 * `POST /api/nextly/preview-links` mints a link for one entry, and
 * `POST /api/nextly/preview-links/revoke` invalidates every link ever issued.
 *
 * Both are POSTs because both change something: minting issues a bearer
 * credential and revoking moves the site's generation. Neither is safe to
 * repeat from a browser's history or to prefetch, which is what a GET invites.
 */
function parsePreviewLinkRoutes(
  id: string | undefined,
  subresource: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (httpMethod !== "POST") return null;
  // Anything deeper than the two known paths is refused rather than falling
  // through to the nearest match. Ignoring the extra segments would make
  // `/preview-links/revoke/anything` revoke every link on the site, which is
  // the most destructive thing either of these endpoints does.
  if (subresource !== undefined) return null;

  if (id === "revoke") {
    return {
      service: "previewLinks",
      operation: "create",
      method: "revokePreviewLinks",
      routeParams,
    };
  }

  if (!id) {
    return {
      service: "previewLinks",
      operation: "create",
      method: "mintPreviewLink",
      routeParams,
    };
  }

  return null;
}

/**
 * `POST /api/nextly/preview-url` resolves where one entry previews.
 *
 * The entry travels in the body rather than the path, because an editor
 * previews what is on screen — including values not yet saved — so there is no
 * id that identifies what is being asked about.
 *
 * Anything deeper is refused rather than folded in. A trailing segment here
 * would otherwise be ignored, and a caller who mistyped a longer path would get
 * a confident answer to a route they did not ask for.
 */
function parsePreviewUrlRoutes(
  id: string | undefined,
  subresource: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // The entry travels in the body, so only POST can carry a request at all.
  // Matching regardless of method would hand a GET straight to the JSON-body
  // handler rather than answering method-not-allowed.
  if (httpMethod !== "POST") return null;
  if (id !== undefined || subresource !== undefined) return null;

  return {
    service: "previewUrl",
    operation: "create",
    method: "resolveEntryPreviewUrl",
    routeParams,
  };
}

function parseApiKeyRoutes(
  id: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (!id && httpMethod === "GET") {
    // GET /api/api-keys → list all keys for authenticated user
    return {
      service: "apiKeys",
      operation: "list",
      method: "listApiKeys",
      routeParams,
    };
  }

  if (!id && httpMethod === "POST") {
    // POST /api/api-keys → create a new API key (session-only)
    return {
      service: "apiKeys",
      operation: "create",
      method: "createApiKey",
      routeParams,
    };
  }

  if (id && httpMethod === "GET") {
    // GET /api/api-keys/:id → get single key metadata
    routeParams.apiKeyId = id;
    return {
      service: "apiKeys",
      operation: "single",
      method: "getApiKeyById",
      routeParams,
    };
  }

  if (id && httpMethod === "PATCH") {
    // PATCH /api/api-keys/:id → update name or description (session-only)
    routeParams.apiKeyId = id;
    return {
      service: "apiKeys",
      operation: "update",
      method: "updateApiKey",
      routeParams,
    };
  }

  if (id && httpMethod === "DELETE") {
    // DELETE /api/api-keys/:id → revoke key (session-only)
    routeParams.apiKeyId = id;
    return {
      service: "apiKeys",
      operation: "delete",
      method: "revokeApiKey",
      routeParams,
    };
  }

  return null;
}

/**
 * The `/api/releases` route table.
 *
 * Declared as data rather than as a branch per route. Eight routes written as
 * eight `if` blocks is one function with twenty-five paths through it, and the
 * shape they all match on — id, subresource, sub-id, verb — is identical, so the
 * branches differ only in their values. Stating the values once means a new
 * route is a row, and means the depth guard and the verb gate cannot be
 * forgotten for one of them.
 *
 * `operation` is the dispatcher's shared vocabulary — list, single, create,
 * update, delete — and deliberately does NOT carry the release authority. The
 * three seeded permissions are read / create / publish, and `publish` has no
 * member in that union; widening a type every service shares to describe one of
 * them would be the wrong trade. The authority each method needs is declared in
 * `api/releases`, beside the handler that enforces it.
 */
interface ReleaseRoute {
  /** Whether the path carries a release id. */
  id: boolean;
  /** The segment after the id, or `null` for none. */
  subresource: string | null;
  /** Whether the path carries a fourth segment, such as a member id. */
  subId: boolean;
  verb: string;
  operation: OperationType;
  method: string;
}

const RELEASE_ROUTES: ReleaseRoute[] = [
  {
    id: false,
    subresource: null,
    subId: false,
    verb: "GET",
    operation: "list",
    method: "listReleases",
  },
  {
    id: false,
    subresource: null,
    subId: false,
    verb: "POST",
    operation: "create",
    method: "createRelease",
  },
  {
    id: true,
    subresource: null,
    subId: false,
    verb: "GET",
    operation: "single",
    method: "getRelease",
  },
  {
    id: true,
    subresource: "members",
    subId: false,
    verb: "GET",
    operation: "list",
    method: "listReleaseMembers",
  },
  {
    id: true,
    subresource: "members",
    subId: false,
    verb: "POST",
    operation: "create",
    method: "addReleaseMember",
  },
  {
    id: true,
    subresource: "members",
    subId: true,
    verb: "DELETE",
    operation: "delete",
    method: "removeReleaseMember",
  },
  // Scheduling and cancelling are separate routes rather than one `PATCH` with a
  // state in the body: they are the two directions of the authority the seed
  // calls "schedule or cancel", and a body field is not something a route table
  // or an audit log can see.
  {
    id: true,
    subresource: "schedule",
    subId: false,
    verb: "POST",
    operation: "update",
    method: "scheduleRelease",
  },
  {
    id: true,
    subresource: "cancel",
    subId: false,
    verb: "POST",
    operation: "update",
    method: "cancelRelease",
  },
  // A READ, and deliberately its own route rather than a field on the detail.
  // Answering it costs an identity lookup over every member, which the detail
  // read must not pay to tell the overwhelming majority of callers that nothing
  // is wrong — the state already said that. Asked instead at the moment
  // somebody is about to commit to an instant.
  {
    id: true,
    subresource: "blockers",
    subId: false,
    verb: "GET",
    operation: "list",
    method: "listReleaseBlockers",
  },
];

/**
 * `/api/releases` — the content-release surface.
 *
 * A release is a first-class object with its own lifecycle rather than a
 * sub-resource of the documents it batches, so it gets a top-level route. That
 * is the shape Contentful, Strapi and Sanity all give it, and the only one that
 * answers "what is going live on Friday?" without starting from a document.
 */
function parseReleaseRoutes(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  additionalParams: string[],
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // Nothing deeper than the table exists. Guarded once, so a longer path 404s
  // instead of matching a shorter route and silently ignoring the tail — which
  // would make `.../schedule/tomorrow` schedule the release.
  if (additionalParams.length > 0) return null;

  const route = RELEASE_ROUTES.find(
    candidate =>
      candidate.id === Boolean(id) &&
      candidate.subresource === (subresource ?? null) &&
      candidate.subId === Boolean(subId) &&
      candidate.verb === httpMethod
  );
  if (!route) return null;

  if (id) routeParams.releaseId = id;
  if (subId) routeParams.memberId = subId;

  return {
    service: "releases",
    operation: route.operation,
    method: route.method,
    routeParams,
  };
}

/**
 * GET /api/jobs → list the most recently touched jobs.
 * GET or POST /api/jobs/run → run one background job pass.
 *
 * `run` is the only path under `jobs`, and it is an operation rather than an
 * id: there is no per-job REST surface yet, so nothing can collide with it.
 * GET is accepted because Vercel Cron triggers with a GET; the pass is
 * idempotent under its lease, and the route authorizes either method.
 */
function parseJobRoutes(
  id: string | undefined,
  subresource: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // GET /api/jobs → the recent-runs read. Ahead of the `run` branch because it
  // is the only shape with no id at all, and a reader must not fall through to
  // a trigger: this route is a read, and running the queue is a side effect
  // nobody asked for by listing it.
  if (id === undefined && !subresource && httpMethod === "GET") {
    return {
      service: "jobs",
      operation: "list",
      method: "listJobs",
      routeParams,
    };
  }

  if (id !== "run" || subresource) return null;
  if (httpMethod !== "POST" && httpMethod !== "GET") return null;
  // Running the queue is not a CRUD OperationType, but the dispatch guard
  // rejects a route with no operation before the direct-dispatch jobs branch
  // runs, so a truthy value is required. The handler does its own
  // authorization and this value is otherwise unused — the same accommodation
  // the webhook drain makes one function below.
  return {
    service: "jobs",
    operation: "single",
    method: "runJobs",
    routeParams,
  };
}

function parseWebhookRoutes(
  id: string | undefined,
  subresource: string | undefined,
  subId: string | undefined,
  additionalParams: string[],
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // GET /api/webhooks/:id/deliveries/:deliveryId → one delivery with its
  // attempt history. Handled before the one-level depth guard below, which is
  // the only two-segment route under an endpoint.
  if (
    id &&
    subresource === "deliveries" &&
    subId &&
    additionalParams.length === 0
  ) {
    if (httpMethod !== "GET") return null;
    routeParams.webhookId = id;
    routeParams.deliveryId = subId;
    return {
      service: "webhooks",
      operation: "single",
      method: "getWebhookDelivery",
      routeParams,
    };
  }

  // POST /api/webhooks/:id/deliveries/:deliveryId/redeliver → re-arm a past
  // delivery for another attempt. Handled here (before the one-level guard)
  // because it is the deepest webhook route.
  if (
    id &&
    subresource === "deliveries" &&
    subId &&
    additionalParams.length === 1 &&
    additionalParams[0] === "redeliver"
  ) {
    if (httpMethod !== "POST") return null;
    routeParams.webhookId = id;
    routeParams.deliveryId = subId;
    return {
      service: "webhooks",
      operation: "single",
      method: "redeliverWebhookDelivery",
      routeParams,
    };
  }

  // POST /api/webhooks/:id/secret/rotate → rotate the signing secret with an
  // overlap window (session-only). Handled before the one-level guard because
  // it nests a level under `secret`.
  if (
    id &&
    subresource === "secret" &&
    subId === "rotate" &&
    additionalParams.length === 0
  ) {
    if (httpMethod !== "POST") return null;
    routeParams.webhookId = id;
    return {
      service: "webhooks",
      operation: "single",
      method: "rotateWebhookSecret",
      routeParams,
    };
  }

  // POST /api/webhooks/:id/secret/expire-old → immediately retire every
  // overlapping (rotated-away) secret, leaving only the primary (session-only).
  if (
    id &&
    subresource === "secret" &&
    subId === "expire-old" &&
    additionalParams.length === 0
  ) {
    if (httpMethod !== "POST") return null;
    routeParams.webhookId = id;
    return {
      service: "webhooks",
      operation: "single",
      method: "expireWebhookOldSecrets",
      routeParams,
    };
  }

  // Nothing else here nests further than one level, so any deeper path is not a
  // route. Without this, `/webhooks/:id/secret/anything` would still match the
  // secret branch and hand back active signing secrets.
  if (subId || additionalParams.length > 0) return null;

  // POST /api/webhooks/:id/test → send a synthetic signed ping to the endpoint
  // and report the outcome. Side-effecting (an outbound request), so it is a
  // POST and authorized like a mutation.
  if (id && subresource === "test") {
    if (httpMethod !== "POST") return null;
    routeParams.webhookId = id;
    return {
      service: "webhooks",
      operation: "single",
      method: "testWebhookEndpoint",
      routeParams,
    };
  }

  if (id && subresource === "deliveries") {
    // GET /api/webhooks/:id/deliveries → the endpoint's delivery log (paged).
    if (httpMethod !== "GET") return null;
    routeParams.webhookId = id;
    return {
      service: "webhooks",
      operation: "list",
      method: "listWebhookDeliveries",
      routeParams,
    };
  }

  // GET or POST /api/webhooks/drain → run one drain pass. "drain" is a reserved
  // operation path, not an endpoint id: endpoint ids are generated UUIDs and
  // cannot collide with it. GET is accepted because Vercel Cron triggers with a
  // GET; the drain is idempotent, and the route is authorized regardless of
  // method. Matched before the generic `GET /webhooks/:id` branch so `drain` is
  // never treated as an endpoint id.
  if (id === "drain" && !subresource) {
    if (httpMethod !== "POST" && httpMethod !== "GET") return null;
    // A drain is not a CRUD OperationType, but the dispatch guard rejects a
    // route with no operation before the direct-dispatch webhooks branch runs;
    // a truthy value is required. The webhook handler dispatches on `method` and
    // does its own authorization, so this value is otherwise unused.
    return {
      service: "webhooks",
      operation: "single",
      method: "drainWebhooks",
      routeParams,
    };
  }

  if (id && subresource === "secret") {
    // GET /api/webhooks/:id/secret → reveal active signing secrets.
    // Its own path rather than a field on the document, so the route can
    // require a stronger permission than an ordinary read.
    if (httpMethod !== "GET") return null;
    routeParams.webhookId = id;
    return {
      service: "webhooks",
      operation: "single",
      method: "revealWebhookSecret",
      routeParams,
    };
  }

  // Anything else below the endpoint is not a route; falling through would
  // match it as the endpoint itself.
  if (subresource) return null;

  if (!id && httpMethod === "GET") {
    // GET /api/webhooks → list every registered endpoint
    return {
      service: "webhooks",
      operation: "list",
      method: "listWebhooks",
      routeParams,
    };
  }

  if (!id && httpMethod === "POST") {
    // POST /api/webhooks → register an endpoint (session-only)
    return {
      service: "webhooks",
      operation: "create",
      method: "createWebhook",
      routeParams,
    };
  }

  if (id && httpMethod === "GET") {
    // GET /api/webhooks/:id → single endpoint, never carrying its secret
    routeParams.webhookId = id;
    return {
      service: "webhooks",
      operation: "single",
      method: "getWebhookById",
      routeParams,
    };
  }

  if (id && httpMethod === "PATCH") {
    // PATCH /api/webhooks/:id → update, including enable/disable (session-only)
    routeParams.webhookId = id;
    return {
      service: "webhooks",
      operation: "update",
      method: "updateWebhook",
      routeParams,
    };
  }

  if (id && httpMethod === "DELETE") {
    // DELETE /api/webhooks/:id → remove endpoint and its deliveries (session-only)
    routeParams.webhookId = id;
    return {
      service: "webhooks",
      operation: "delete",
      method: "deleteWebhook",
      routeParams,
    };
  }

  return null;
}

// ============================================================================
// Dashboard Routes
// ============================================================================

/**
 * Parse the translation worklist route.
 *
 *   GET /api/translations → getTranslationWorklist
 *
 * GET-only and authenticated; the handler owns its own auth, and which rows come
 * back is decided per row by each collection's read rules.
 *
 * Bare rather than nested under a language (`/translations/es`): the language is
 * a filter over one list, not a different resource, and it travels as a query
 * parameter beside the state and the limit it belongs with.
 */
function parseTranslationRoutes(
  id: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (httpMethod !== "GET") return null;
  if (id !== undefined) return null;
  return {
    service: "translations",
    operation: "list",
    method: "getTranslationWorklist",
    routeParams,
  };
}

/**
 * Every `/api/dashboard` route, as a table keyed by verb and then by id.
 *
 * A table rather than a ladder of `if`s. The ladder's cyclomatic complexity
 * grew with the route count and tripped the repository's threshold at the
 * sixth route, and each new arm restated four lines of the same object literal
 * — so a route added under the wrong `operation` looked exactly like one added
 * under the right one.
 */
const DASHBOARD_ROUTES: Readonly<
  Record<
    string,
    Readonly<
      Record<
        string,
        { operation: NonNullable<ParsedRoute["operation"]>; method: string }
      >
    >
  >
> = {
  GET: {
    stats: { operation: "list", method: "getDashboardStats" },
    "recent-entries": {
      operation: "list",
      method: "getDashboardRecentEntries",
    },
    activity: { operation: "list", method: "getDashboardActivity" },
    layout: { operation: "list", method: "getWidgetLayout" },
  },
  POST: {
    query: { operation: "list", method: "postWidgetQuery" },
  },
  PUT: {
    layout: { operation: "update", method: "putWidgetLayout" },
  },
};

/**
 * Parse dashboard-related routes.
 *
 *   GET  /api/dashboard/stats          → getDashboardStats
 *   GET  /api/dashboard/recent-entries → getDashboardRecentEntries
 *   GET  /api/dashboard/activity       → getDashboardActivity
 *   GET  /api/dashboard/layout         → getWidgetLayout
 *   PUT  /api/dashboard/layout         → putWidgetLayout
 *   POST /api/dashboard/query          → postWidgetQuery
 *
 * All require authentication (no specific permission). Handlers manage their
 * own auth.
 */
function parseDashboardRoutes(
  id: string | undefined,
  subresource: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // Nothing deeper than the top-level id segment exists under `/dashboard`.
  // Guarded once, so a longer path 404s instead of matching a shorter route
  // and silently ignoring the tail — which would let
  // `/api/dashboard/query/extra` reach the widget-query executor. Segments
  // are contiguous, so a truthy `subresource` is the only way a sub-id or
  // anything past it could exist — the same shape `parseJobRoutes` uses.
  if (subresource || id === undefined) return null;

  // 🔴 `Object.hasOwn` on BOTH lookups, because both keys come off the URL.
  // A plain `TABLE[key]` reaches `Object.prototype`, so `OPTIONS` is safely
  // absent but `constructor` is not: `DASHBOARD_ROUTES.constructor` is a
  // function, and `.constructor.constructor` a truthy object, so
  // `/api/dashboard/constructor` would get past a bare presence check and
  // dispatch on `route.method` read off `Object`. This is the same hole the
  // widget span-class and archetype tables already closed.
  if (!Object.hasOwn(DASHBOARD_ROUTES, httpMethod)) return null;
  const byId = DASHBOARD_ROUTES[httpMethod];
  if (!Object.hasOwn(byId, id)) return null;

  const route = byId[id];
  return {
    service: "dashboard",
    operation: route.operation,
    method: route.method,
    routeParams,
  };
}

// ============================================================================
// Schema Routes Parser
// ============================================================================

/**
 * Parse schema-related routes (F10 PR 4).
 *
 *   GET /api/schema/journal → getSchemaJournal (super-admin only)
 *
 * The journal endpoint returns recent `nextly_migration_journal` rows
 * paginated by a `started_at` cursor. Used by the admin
 * NotificationBell + Dropdown to render audit-log entries.
 *
 * Auth + permission checks live inside the handler itself so the
 * router stays a pure URL → handler-name mapping.
 */
function parseSchemaRoutes(
  id: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (httpMethod !== "GET") return null;

  if (id === "journal") {
    return {
      service: "schema",
      operation: "list",
      method: "getSchemaJournal",
      routeParams,
    };
  }

  return null;
}

// ============================================================================
// Email Routes Parser
// ============================================================================

/**
 * Parse Email send routes
 *
 * Handles email send endpoints (no specific permission required, any
 * authenticated request including API keys can call these):
 * - POST /api/email/send → send raw email
 * - POST /api/email/send-with-template → send templated email
 */
function parseEmailRoutes(
  id: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (id === "send" && httpMethod === "POST") {
    return {
      service: "email",
      operation: "create",
      method: "send",
      routeParams,
    };
  }
  if (id === "send-with-template" && httpMethod === "POST") {
    return {
      service: "email",
      operation: "create",
      method: "sendWithTemplate",
      routeParams,
    };
  }
  return null;
}

// ============================================================================
// Main Route Parser
// ============================================================================

/**
 * Parse REST route and return service/operation/method mapping
 *
 * Examples:
 * - GET /api/users → list all users
 * - GET /api/users/123 → get user by id
 * - POST /api/users → create user
 * - PATCH /api/users/123 → update user
 * - DELETE /api/users/123 → delete user
 * - GET /api/roles → list all roles
 * - POST /api/collections/products/entries → create entry
 * - POST /api/forms/contact/submit → submit form
 */
export function parseRestRoute(
  params: string[],
  httpMethod: string,
  searchParams?: URLSearchParams
): ParsedRoute {
  if (params.length === 0) return {};

  const [resource, id, subresource, subId, ...additionalParams] = params;
  const routeParams: Record<string, string> = {};

  // Add search parameters to routeParams
  if (searchParams) {
    let hasBracketWhere = false;

    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith("where[")) {
        hasBracketWhere = true;
      } else {
        routeParams[key] = value;
      }
    }

    // Parse bracket notation where params (e.g. where[slug][equals]=value)
    // into a JSON string so the dispatcher's parseWhereParam() can handle it
    if (hasBracketWhere && !routeParams.where) {
      const parsed = parseWhereQuery(searchParams);
      if (parsed) {
        routeParams.where = JSON.stringify(parsed);
      }
    }
  }

  // Handle /api/me endpoint for current user
  // For /api/me/permissions, id = "permissions" (sub-resource)
  if (resource === "me") {
    const result = parseMeRoutes(httpMethod, id, routeParams);
    if (result) return result;
  }

  // Handle Users endpoints
  if (resource === "users") {
    const result = parseUserRoutes(
      id,
      subresource,
      subId,
      additionalParams,
      httpMethod,
      routeParams
    );
    if (result) return result;
  }

  // Handle Roles endpoints
  if (resource === "roles") {
    const result = parseRoleRoutes(
      id,
      subresource,
      subId,
      httpMethod,
      routeParams
    );
    if (result) return result;
  }

  // Handle Collections endpoints
  if (resource === "collections") {
    // Nested version history is matched first: it sits deeper than the entry
    // routes below, which would otherwise claim the path.
    const versionResult = parseCollectionEntryVersionRoutes(
      id,
      subresource,
      subId,
      additionalParams,
      httpMethod,
      routeParams
    );
    if (versionResult) return versionResult;

    const result = parseCollectionRoutes(
      id,
      subresource,
      subId,
      httpMethod,
      routeParams,
      additionalParams
    );
    if (result) return result;
  }

  // Handle Permissions endpoints
  if (resource === "permissions") {
    const result = parsePermissionRoutes(id, httpMethod, routeParams);
    if (result) return result;
  }

  // Handle Singles endpoints (globals)
  if (resource === "singles") {
    // Version history is matched before the schema/document routes so
    // `/singles/{slug}/versions` is not read as a sub-resource of the document.
    const versionResult = parseSingleVersionRoutes(
      id,
      subresource,
      subId,
      additionalParams,
      httpMethod,
      routeParams
    );
    if (versionResult) return versionResult;

    const result = parseSingleRoutes(
      id,
      subresource,
      subId,
      httpMethod,
      routeParams
    );
    if (result) return result;
  }

  // Handle Forms endpoints (public form builder)
  if (resource === "forms") {
    const result = parseFormsRoutes(id, subresource, httpMethod, routeParams);
    if (result) return result;
  }

  // Handle Components endpoints
  if (resource === "field-groups") {
    const result = parseComponentRoutes(
      id,
      httpMethod,
      routeParams,
      subresource,
      subId
    );
    if (result) return result;
  }

  // Handle Email send endpoints (any authenticated request)
  if (resource === "email") {
    const result = parseEmailRoutes(id, httpMethod, routeParams);
    if (result) return result;
  }

  // Handle Email Providers endpoints
  if (resource === "email-providers") {
    const result = parseEmailProviderRoutes(
      id,
      subresource,
      httpMethod,
      routeParams
    );
    if (result) return result;
  }

  // Handle Email Templates endpoints
  if (resource === "email-templates") {
    const result = parseEmailTemplateRoutes(
      id,
      subresource,
      httpMethod,
      routeParams
    );
    if (result) return result;
  }

  // Handle User Fields endpoints (custom user field definitions)
  if (resource === "user-fields") {
    const result = parseUserFieldRoutes(
      id,
      subresource,
      httpMethod,
      routeParams
    );
    if (result) return result;
  }

  // Handle preview link minting and revocation
  if (resource === "preview-links") {
    const result = parsePreviewLinkRoutes(
      id,
      subresource,
      httpMethod,
      routeParams
    );
    if (result) return result;
  }

  // Handle resolving where an entry previews
  if (resource === "preview-url") {
    const result = parsePreviewUrlRoutes(
      id,
      subresource,
      httpMethod,
      routeParams
    );
    if (result) return result;
  }

  // Handle API Keys endpoints
  if (resource === "api-keys") {
    const result = parseApiKeyRoutes(id, httpMethod, routeParams);
    if (result) return result;
  }

  // Handle content releases
  if (resource === "releases") {
    const result = parseReleaseRoutes(
      id,
      subresource,
      subId,
      additionalParams,
      httpMethod,
      routeParams
    );
    if (result) return result;
  }

  // Handle Webhook endpoint management
  if (resource === "webhooks") {
    const result = parseWebhookRoutes(
      id,
      subresource,
      subId,
      additionalParams,
      httpMethod,
      routeParams
    );
    if (result) return result;
  }

  // Handle the background job trigger
  if (resource === "jobs") {
    const result = parseJobRoutes(id, subresource, httpMethod, routeParams);
    if (result) return result;
  }

  // Handle the translation worklist
  if (resource === "translations") {
    const result = parseTranslationRoutes(id, httpMethod, routeParams);
    if (result) return result;
  }

  // Handle Dashboard endpoints
  if (resource === "dashboard") {
    const result = parseDashboardRoutes(
      id,
      subresource,
      httpMethod,
      routeParams
    );
    if (result) return result;
  }

  // Handle Schema endpoints (F10 PR 4: journal read endpoint)
  if (resource === "schema") {
    const result = parseSchemaRoutes(id, httpMethod, routeParams);
    if (result) return result;
  }

  // Handle General Settings endpoint
  if (resource === "general-settings") {
    const method =
      httpMethod === "GET" ? "getGeneralSettings" : "updateGeneralSettings";
    const operation = httpMethod === "GET" ? "single" : "update";
    return { service: "generalSettings", operation, method, routeParams };
  }

  // Handle Image Sizes endpoints
  if (resource === "image-sizes") {
    // Sub-routes for regeneration
    if (id === "regeneration-status") {
      return {
        service: "imageSizes",
        operation: "single",
        method: "regenerationStatus",
        routeParams,
      };
    }
    if (id === "regenerate") {
      return {
        service: "imageSizes",
        operation: "single",
        method: "regenerate",
        routeParams,
      };
    }
    if (id) routeParams.imageId = id;
    return {
      service: "imageSizes",
      operation: "list",
      method: "imageSizes",
      routeParams,
    };
  }

  return {};
}
