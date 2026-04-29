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
  // Components list endpoint is public (admin UI needs to list components)
  if (service === "components" && method === "listComponents") {
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
  // Component reads: admin UI needs to fetch component details for embedding
  if (service === "components" && method === "getComponent") {
    return true;
  }
  return false;
}

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

  if (id && subresource === "entries" && subId && httpMethod === "GET") {
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

  if (id && subresource === "entries" && subId && httpMethod === "PATCH") {
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

  if (id && subresource === "entries" && subId && httpMethod === "DELETE") {
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
 * Parse bulk delete route for collection entries
 * POST /api/collections/{slug}/entries/bulk-delete
 */
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

  return null;
}

// ============================================================================
// Components Routes Parser
// ============================================================================

/**
 * Parse Components routes
 *
 * Handles component definition endpoints:
 * - GET /api/components → list all components
 * - POST /api/components → create component (Schema Builder)
 * - GET /api/components/[slug] → get component by slug
 * - PATCH /api/components/[slug] → update component
 * - DELETE /api/components/[slug] → delete component
 */
function parseComponentRoutes(
  slug: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  // GET /api/components → list all components
  if (!slug && httpMethod === "GET") {
    return {
      service: "components",
      operation: "list",
      method: "listComponents",
      routeParams,
    };
  }

  // POST /api/components → create component (Schema Builder)
  if (!slug && httpMethod === "POST") {
    return {
      service: "components",
      operation: "create",
      method: "createComponent",
      routeParams,
    };
  }

  // GET /api/components/[slug] → get component by slug
  if (slug && httpMethod === "GET") {
    routeParams.slug = slug;
    return {
      service: "components",
      operation: "single",
      method: "getComponent",
      routeParams,
    };
  }

  // PATCH /api/components/[slug] → update component
  if (slug && httpMethod === "PATCH") {
    routeParams.slug = slug;
    return {
      service: "components",
      operation: "update",
      method: "updateComponent",
      routeParams,
    };
  }

  // DELETE /api/components/[slug] → delete component
  if (slug && httpMethod === "DELETE") {
    routeParams.slug = slug;
    return {
      service: "components",
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
 * - POST /api/email-providers/[id]/test → send test email
 */
function parseEmailProviderRoutes(
  id: string | undefined,
  subresource: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
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

  // GET /api/email-templates/layout → get shared layout (header/footer)
  if (id === "layout" && !subresource && httpMethod === "GET") {
    return {
      service: "emailTemplates",
      operation: "single",
      method: "getLayout",
      routeParams,
    };
  }

  // PATCH /api/email-templates/layout → update shared layout
  if (id === "layout" && !subresource && httpMethod === "PATCH") {
    return {
      service: "emailTemplates",
      operation: "update",
      method: "updateLayout",
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

// ============================================================================
// Dashboard Routes
// ============================================================================

/**
 * Parse dashboard-related routes.
 *
 *   GET /api/dashboard/stats          → getDashboardStats
 *   GET /api/dashboard/recent-entries → getDashboardRecentEntries
 *   GET /api/dashboard/activity       → getDashboardActivity
 *
 * All dashboard endpoints are GET-only and require authentication
 * (no specific permission). Handlers manage their own auth.
 */
function parseDashboardRoutes(
  id: string | undefined,
  httpMethod: string,
  routeParams: Record<string, string>
): ParsedRoute | null {
  if (httpMethod !== "GET") return null;

  if (id === "stats") {
    return {
      service: "dashboard",
      operation: "list",
      method: "getDashboardStats",
      routeParams,
    };
  }

  if (id === "recent-entries") {
    return {
      service: "dashboard",
      operation: "list",
      method: "getDashboardRecentEntries",
      routeParams,
    };
  }

  if (id === "activity") {
    return {
      service: "dashboard",
      operation: "list",
      method: "getDashboardActivity",
      routeParams,
    };
  }

  return null;
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
    const result = parseSingleRoutes(id, subresource, httpMethod, routeParams);
    if (result) return result;
  }

  // Handle Forms endpoints (public form builder)
  if (resource === "forms") {
    const result = parseFormsRoutes(id, subresource, httpMethod, routeParams);
    if (result) return result;
  }

  // Handle Components endpoints
  if (resource === "components") {
    const result = parseComponentRoutes(id, httpMethod, routeParams);
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

  // Handle API Keys endpoints
  if (resource === "api-keys") {
    const result = parseApiKeyRoutes(id, httpMethod, routeParams);
    if (result) return result;
  }

  // Handle Dashboard endpoints
  if (resource === "dashboard") {
    const result = parseDashboardRoutes(id, httpMethod, routeParams);
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
