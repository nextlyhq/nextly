import { useQuery } from "@tanstack/react-query";

import { protectedApi } from "../lib/api/protectedApi";
import type {
  AdminCapabilities,
  CollectionCapabilities,
  UserPermissionsResponse,
} from "../types/permissions";

/**
 * System resources that are NOT dynamic collections.
 * Permissions for these resources map to dedicated capability flags
 * rather than per-collection capabilities.
 */
const SYSTEM_RESOURCES = new Set([
  "users",
  "roles",
  "permissions",
  "media",
  "settings",
  "email-providers",
  "email-templates",
  "api-keys",
]);

/**
 * Build AdminCapabilities from a flat list of permission slugs.
 *
 * Permission slugs follow the format "{action}-{resource}"
 * (e.g., "read-users", "create-posts", "manage-settings").
 */
function buildCapabilities(
  permissions: string[],
  isSuperAdmin: boolean
): AdminCapabilities {
  // Super-admin gets everything
  if (isSuperAdmin) {
    return {
      isSuperAdmin: true,
      canViewCollections: true,
      canViewUsers: true,
      canViewRoles: true,
      canViewMedia: true,
      canViewSettings: true,
      collections: new Proxy({}, {
        get: () => ({
          canRead: true,
          canCreate: true,
          canUpdate: true,
          canDelete: true,
        }),
      }),
      canManageUsers: true,
      canManageRoles: true,
      canManageMedia: true,
      canManageSettings: true,
      canManageEmailProviders: true,
      canManageEmailTemplates: true,
    };
  }

  const permSet = new Set(permissions);
  const collections: Record<string, CollectionCapabilities> = {};

  // Parse permissions to build per-collection capabilities
  for (const perm of permissions) {
    // Match "action-resource" format, where resource can contain hyphens
    const dashIdx = perm.indexOf("-");
    if (dashIdx === -1) continue;

    const action = perm.slice(0, dashIdx);
    const resource = perm.slice(dashIdx + 1);

    // Skip system resources — they map to dedicated flags
    if (SYSTEM_RESOURCES.has(resource)) continue;

    // Build collection capabilities
    if (!collections[resource]) {
      collections[resource] = {
        canRead: false,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
      };
    }

    if (action === "read") collections[resource].canRead = true;
    if (action === "create") collections[resource].canCreate = true;
    if (action === "update") collections[resource].canUpdate = true;
    if (action === "delete") collections[resource].canDelete = true;
  }

  // Check if user can view any collection
  const canViewCollections = Object.values(collections).some(c => c.canRead);

  return {
    isSuperAdmin: false,
    canViewCollections,
    canViewUsers: permSet.has("read-users"),
    canViewRoles: permSet.has("read-roles"),
    canViewMedia: permSet.has("read-media") || permSet.has("manage-media"),
    canViewSettings:
      permSet.has("manage-settings") ||
      permSet.has("read-api-keys") ||
      permSet.has("create-api-keys") ||
      permSet.has("update-api-keys") ||
      permSet.has("delete-api-keys") ||
      permSet.has("manage-api-keys") ||
      permSet.has("manage-email-providers") ||
      permSet.has("manage-email-templates"),
    collections,
    canManageUsers: permSet.has("create-users") || permSet.has("update-users"),
    canManageRoles: permSet.has("create-roles") || permSet.has("update-roles"),
    canManageMedia: permSet.has("manage-media"),
    canManageSettings: permSet.has("manage-settings"),
    canManageEmailProviders: permSet.has("manage-email-providers"),
    canManageEmailTemplates: permSet.has("manage-email-templates"),
  };
}

/** Default capabilities (no access) shown while loading */
const EMPTY_CAPABILITIES: AdminCapabilities = {
  isSuperAdmin: false,
  canViewCollections: false,
  canViewUsers: false,
  canViewRoles: false,
  canViewMedia: false,
  canViewSettings: false,
  collections: {},
  canManageUsers: false,
  canManageRoles: false,
  canManageMedia: false,
  canManageSettings: false,
  canManageEmailProviders: false,
  canManageEmailTemplates: false,
};

/**
 * Hook to fetch and cache the current user's resolved permissions.
 *
 * Returns an `AdminCapabilities` object with boolean flags for
 * sidebar filtering, route guards, and action visibility.
 *
 * - Super-admin users get all capabilities as `true` (short-circuit).
 * - Other users get capabilities computed from their resolved permission slugs.
 * - Cached via TanStack Query with 5-minute stale time (global default).
 *
 * @example
 * ```tsx
 * const { capabilities, isLoading, hasPermission } = useCurrentUserPermissions();
 *
 * if (capabilities.canViewUsers) {
 *   // Show users nav item
 * }
 *
 * if (hasPermission('read-posts')) {
 *   // Show posts section
 * }
 * ```
 */
export function useCurrentUserPermissions() {
  // Wire shape (post task-24 phase 4): `{ data: <UserPermissionsResponse> }`.
  // The fetcher peels the single `data` layer, so `data` here IS the
  // permissions payload directly.
  const { data, isLoading, error } = useQuery<UserPermissionsResponse>({
    queryKey: ["currentUserPermissions"],
    queryFn: () =>
      protectedApi.get<UserPermissionsResponse>("/me/permissions"),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const permissions = data?.permissions ?? [];
  const isSuperAdmin = data?.isSuperAdmin ?? false;
  const roles = data?.roles ?? [];

  const capabilities = data
    ? buildCapabilities(permissions, isSuperAdmin)
    : EMPTY_CAPABILITIES;

  /**
   * Check if the current user has a specific permission by slug.
   * Super-admin always returns true.
   */
  const hasPermission = (slug: string): boolean => {
    if (isSuperAdmin) return true;
    return permissions.includes(slug);
  };

  /**
   * Check if the current user can perform an action on a collection.
   * Useful for dynamic collection permission checks.
   */
  const canAccessCollection = (
    collectionSlug: string,
    action: "read" | "create" | "update" | "delete"
  ): boolean => {
    if (isSuperAdmin) return true;
    return permissions.includes(`${action}-${collectionSlug}`);
  };

  return {
    capabilities,
    permissions,
    roles,
    isSuperAdmin,
    isLoading,
    error,
    hasPermission,
    canAccessCollection,
  };
}
