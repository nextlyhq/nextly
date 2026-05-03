import type { ListResponse, TableParams } from "@revnixhq/ui";

import { normalizePermissions } from "@admin/lib/permissions/normalize";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { fetcher } from "../lib/api/fetcher";
import type {
  ActionResponse,
  MutationResponse,
} from "../lib/api/response-types";
import type {
  ApiRole,
  Role,
  ApiRoleCreatePayload,
  ApiRoleUpdatePayload,
} from "../types/entities";
import type { ApiRoleWithRelations } from "../types/role";

// Phase 4 (Task 19): the role-permissions sub-resource is a non-CRUD read
// returning a bare list of permission objects via respondDoc. We type the
// fetcher with the bare array shape.
const fetchRolePermissionIds = async (roleId: string): Promise<string[]> => {
  const result = await fetcher<
    Array<{
      id: string;
      action: string;
      resource: string;
    }>
  >(`/roles/${roleId}/permissions`, {}, true);

  return normalizePermissions(result.map(permission => permission.id));
};

// Transform API role to our Role interface
const transformRole = (
  apiRole: ApiRole & {
    permissionIds?: unknown;
    permissions?: unknown;
  }
): Role => ({
  id: apiRole.id,
  roleName: apiRole.name,
  name: apiRole.name,
  subtitle: apiRole.isSystem ? "System role" : "Custom role",
  description: apiRole.description || `Role with level ${apiRole.level}`,
  type: apiRole.isSystem ? "System" : "Custom",
  permissions: normalizePermissions(
    apiRole.permissionIds ?? (apiRole as { permissions?: unknown }).permissions
  ),
  status: "Active",
  created: new Date().toISOString().split("T")[0],
});

// Build query string for pagination and search using shared utility
const buildQuery = (params: TableParams): string => {
  return buildQueryUtil(params, {
    fieldMapping: {
      roleName: "name",
      name: "name",
    },
    validSortFields: ["name", "level"],
    includeFilters: true,
    includePopulate: true,
  });
};

/**
 * Fetch paginated list of roles.
 *
 * Phase 4.7: pass canonical ListResponse through, applying transformRole
 * over `items`. The legacy normalizePagination adapter is gone.
 */
export const fetchRoles = async (
  params: TableParams
): Promise<ListResponse<Role>> => {
  const query = buildQuery(params);
  const url = `/roles${query ? `?${query}&includePermissions=true` : ""}`;

  const result = await fetcher<ListResponse<ApiRole>>(url, {}, true);

  return {
    items: result.items.map(transformRole),
    meta: result.meta,
  };
};

/**
 * Update a role's metadata.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<ApiRole>`; we discard
 * the message + item because the caller expects void.
 */
export const updateRole = async (
  roleId: string,
  updates: Partial<Role> & { childRoleIds?: string[] }
): Promise<void> => {
  const apiUpdates: ApiRoleUpdatePayload = {};
  if (updates.roleName !== undefined) apiUpdates.name = updates.roleName;
  if (updates.type !== undefined)
    apiUpdates.isSystem = updates.type === "System";
  if (updates.description !== undefined)
    apiUpdates.description = updates.description;
  if (updates.slug !== undefined) apiUpdates.slug = updates.slug;
  // Pass through child role inheritance if provided
  if (updates.childRoleIds) {
    apiUpdates.childRoleIds = updates.childRoleIds;
  }

  await fetcher<MutationResponse<ApiRole>>(
    `/roles/${roleId}`,
    {
      method: "PATCH",
      body: JSON.stringify(apiUpdates),
    },
    true
  );
};

/**
 * Delete a role.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<ApiRole>` for delete;
 * we discard the body.
 */
export const deleteRole = async (roleId: string): Promise<void> => {
  await fetcher<MutationResponse<ApiRole>>(
    `/roles/${roleId}`,
    {
      method: "DELETE",
    },
    true
  );
};

/**
 * Get a role by ID.
 *
 * Phase 4 (Task 19): findByID returns the bare doc via respondDoc, and the
 * sub-resource `/roles/:id/permissions` returns a bare list. Both are typed
 * directly without an envelope wrapper.
 */
export const getRoleById = async (roleId: string): Promise<Role> => {
  const [apiRole, permissionIds] = await Promise.all([
    fetcher<ApiRoleWithRelations>(`/roles/${roleId}`, {}, true),
    fetchRolePermissionIds(roleId),
  ]);

  return transformRole({
    ...(apiRole as ApiRole),
    permissionIds,
  });
};

/**
 * Fetch role once and also provide extracted childRoleIds to avoid extra
 * requests.
 *
 * Phase 4 (Task 19): the sub-resources `/roles/:id/parents` and
 * `/roles/:id` both return bare bodies (respondDoc); we type the generic
 * with the inner shape directly.
 */
export const getRoleDetails = async (
  roleId: string
): Promise<{
  role: Role;
  childRoleIds: string[];
  childRolePermissionsMap?: Record<string, string[]>;
}> => {
  const [apiRole, permissionIds, parentRoleIds] = await Promise.all([
    fetcher<ApiRoleWithRelations>(`/roles/${roleId}`, {}, true),
    fetchRolePermissionIds(roleId),
    // The parents endpoint returns a bare string[] via respondDoc.
    fetcher<string[]>(`/roles/${roleId}/parents`, {}, true).then(
      ids => ids || []
    ),
  ]);

  let childRolePermissionsMap: Record<string, string[]> | undefined;
  if (parentRoleIds.length > 0) {
    const parentRoles = await Promise.all(
      parentRoleIds.map(async parentRoleId => {
        const parentRole = await getRoleById(parentRoleId);
        return [
          parentRoleId,
          normalizePermissions(parentRole.permissions),
        ] as const;
      })
    );

    childRolePermissionsMap = Object.fromEntries(parentRoles);
  }

  return {
    role: transformRole({
      ...(apiRole as ApiRole),
      permissionIds,
    }),
    childRoleIds: parentRoleIds,
    childRolePermissionsMap,
  };
};

/**
 * Update role permissions by diffing current vs next permission ID arrays.
 *
 * Phase 4 (Task 19): the role-permissions sub-resource is a non-CRUD
 * mutation returning `ActionResponse` (`{ message, ... }`); we discard
 * the body since the caller expects void.
 */
export const updateRolePermissions = async (
  roleId: string,
  currentPermissionIds: string[],
  nextPermissionIds: string[]
): Promise<void> => {
  void currentPermissionIds;

  await fetcher<ActionResponse>(
    `/roles/${roleId}/permissions`,
    {
      method: "PATCH",
      body: JSON.stringify({
        permissionIds: normalizePermissions(nextPermissionIds),
      }),
    },
    true
  );
};

/**
 * Create a new role.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<ApiRole>`; we read
 * `item.id` to keep the legacy `{ id }` projection callers expect.
 */
export const createRole = async (
  roleData: Partial<Role> & { childRoleIds?: string[] }
): Promise<{ id: string }> => {
  const apiData: ApiRoleCreatePayload = {
    name: roleData.roleName || "",
    level: 0,
    isSystem: Boolean(roleData.type === "System"),
    description: roleData.description || "",
    permissionIds: Array.isArray(roleData.permissions)
      ? roleData.permissions
      : [],
    slug: roleData.slug,
    childRoleIds: Array.isArray(roleData.childRoleIds)
      ? roleData.childRoleIds
      : [],
  };

  const result = await fetcher<MutationResponse<{ id: string }>>(
    `/roles`,
    {
      method: "POST",
      body: JSON.stringify(apiData),
    },
    true
  );

  return { id: result.item.id };
};

/**
 * Stats projection over the roles list.
 *
 * Phase 4 (Task 19): typed against the canonical `ListResponse<ApiRole>`;
 * we read `result.items` for the role array.
 */
export const getStats = async () => {
  try {
    const result = await fetcher<ListResponse<ApiRole>>(`/roles`, {}, true);

    const roles = result.items;
    return {
      totalRoles: roles.length,
      systemRoles: roles.filter((r: ApiRole) => r.isSystem).length,
      customRoles: roles.filter((r: ApiRole) => !r.isSystem).length,
    };
  } catch (error) {
    // Log error but return zeros instead of throwing to prevent UI crashes
    // React Query will cache this result, so components should handle zero state
    console.error("Failed to fetch role statistics:", error);
    return {
      totalRoles: 0,
      systemRoles: 0,
      customRoles: 0,
    };
  }
};

// Export all functions
export const roleApi = {
  fetchRoles,
  createRole,
  updateRole,
  deleteRole,
  getRoleById,
  getRoleDetails,
  getStats,
  updateRolePermissions,
};
