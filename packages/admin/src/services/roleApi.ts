import { TableParams, TableResponse } from "@revnixhq/ui";

import { normalizePermissions } from "@admin/lib/permissions/normalize";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { enhancedFetcher } from "../lib/api/enhancedFetcher";
import { normalizePagination } from "../lib/api/normalizePagination";
import {
  ApiRole,
  Role,
  ApiRoleCreatePayload,
  ApiRoleUpdatePayload,
} from "../types/entities";
import {
  ApiRoleWithRelations,
  ApiPermission,
  ApiChildRole,
} from "../types/role";

const fetchRolePermissionIds = async (roleId: string): Promise<string[]> => {
  const result = await enhancedFetcher<
    Array<{
      id: string;
      action: string;
      resource: string;
    }>
  >(`/roles/${roleId}/permissions`, {}, true);

  return normalizePermissions(result.data.map(permission => permission.id));
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

export const fetchRoles = async (
  params: TableParams
): Promise<TableResponse<Role>> => {
  const query = buildQuery(params);
  const url = `/roles${query ? `?${query}&includePermissions=true` : ""}`;

  const result = await enhancedFetcher<ApiRole[], Record<string, unknown>>(
    url,
    {},
    true
  );

  const roles = result.data.map(transformRole);
  const { pageSize = 10 } = params.pagination;
  const meta = normalizePagination(result.meta, pageSize, roles.length);

  return { data: roles, meta };
};

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

  await enhancedFetcher<null>(
    `/roles/${roleId}`,
    {
      method: "PATCH",
      body: JSON.stringify(apiUpdates),
    },
    true
  );
};

export const deleteRole = async (roleId: string): Promise<void> => {
  await enhancedFetcher<{ id: string }>(
    `/roles/${roleId}`,
    {
      method: "DELETE",
    },
    true
  );
};

export const getRoleById = async (roleId: string): Promise<Role> => {
  const [result, permissionIds] = await Promise.all([
    enhancedFetcher<ApiRoleWithRelations>(`/roles/${roleId}`, {}, true),
    fetchRolePermissionIds(roleId),
  ]);

  return transformRole({
    ...(result.data as ApiRole),
    permissionIds,
  });
};

// Fetch role once and also provide extracted childRoleIds to avoid extra requests
export const getRoleDetails = async (
  roleId: string
): Promise<{
  role: Role;
  childRoleIds: string[];
  childRolePermissionsMap?: Record<string, string[]>;
}> => {
  const [result, permissionIds, parentRoleIds] = await Promise.all([
    enhancedFetcher<ApiRoleWithRelations>(`/roles/${roleId}`, {}, true),
    fetchRolePermissionIds(roleId),
    enhancedFetcher<string[]>(`/roles/${roleId}/parents`, {}, true).then(
      response => response.data || []
    ),
  ]);

  const apiRole = result.data;

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

// Update role permissions by diffing current vs next permission ID arrays
export const updateRolePermissions = async (
  roleId: string,
  currentPermissionIds: string[],
  nextPermissionIds: string[]
): Promise<void> => {
  void currentPermissionIds;

  await enhancedFetcher(
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

  const result = await enhancedFetcher<{ id: string }>(
    `/roles`,
    {
      method: "POST",
      body: JSON.stringify(apiData),
    },
    true
  );

  return { id: result.data.id };
};

export const getStats = async () => {
  try {
    const result = await enhancedFetcher<ApiRole[]>(`/roles`, {}, true);

    const roles = result.data;
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
