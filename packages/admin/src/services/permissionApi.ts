import type { TableParams, TableResponse } from "@revnixhq/ui";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { enhancedFetcher } from "../lib/api/enhancedFetcher";
import { normalizePagination } from "../lib/api/normalizePagination";
import type { Permission } from "../types/entities";

/**
 * Real permission entry shape returned by the backend API.
 */
interface ApiPermissionEntry {
  id: string;
  name: string;
  slug: string;
  action: string;
  resource: string;
  description: string | null;
}

interface ApiPermissionMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Map a backend permission entry to the admin Permission entity shape.
 */
function toPermission(entry: ApiPermissionEntry): Permission {
  return {
    id: entry.id,
    name: entry.name,
    subtitle: `${entry.action}:${entry.resource}`,
    description: entry.description ?? "",
    usage: "Not Used",
    created: "",
  };
}

const buildQuery = (params: TableParams): string => {
  return buildQueryUtil(params, {
    fieldMapping: {
      name: "name",
      slug: "slug",
      action: "action",
      resource: "resource",
    },
    validSortFields: ["name", "slug", "action", "resource"],
  });
};

/**
 * Fetch permissions with pagination, search, and sorting.
 * Calls GET /api/permissions with query parameters derived from TableParams.
 */
export const fetchPermissions = async (
  params: TableParams
): Promise<TableResponse<Permission>> => {
  const query = buildQuery(params);
  const url = `/permissions${query ? `?${query}` : ""}`;

  const result = await enhancedFetcher<ApiPermissionEntry[], ApiPermissionMeta>(
    url,
    {},
    true
  );

  const data = (result.data ?? []).map(toPermission);
  const { pageSize } = params.pagination;
  const meta = normalizePagination(
    result.meta as Record<string, unknown> | undefined,
    pageSize,
    data.length
  );

  return { data, meta };
};

/**
 * Get a single permission by ID.
 * Calls GET /api/permissions/:id
 */
export const getPermissionById = async (
  permissionId: string
): Promise<Permission> => {
  const result = await enhancedFetcher<ApiPermissionEntry>(
    `/permissions/${permissionId}`,
    {},
    true
  );

  return toPermission(result.data);
};

/**
 * Update a permission's fields.
 * Calls PATCH /api/permissions/:id, then fetches the updated record.
 */
export const updatePermission = async (
  permissionId: string,
  updates: Partial<Permission>
): Promise<Permission> => {
  await enhancedFetcher<null>(
    `/permissions/${permissionId}`,
    {
      method: "PATCH",
      body: JSON.stringify(updates),
    },
    true
  );

  // Fetch the updated record to return the current state
  return getPermissionById(permissionId);
};

/**
 * Delete a permission by ID.
 * Calls DELETE /api/permissions/:id
 */
export const deletePermission = async (permissionId: string): Promise<void> => {
  await enhancedFetcher<null>(
    `/permissions/${permissionId}`,
    { method: "DELETE" },
    true
  );
};

/**
 * Composable API object (for convenience and backward compatibility)
 */
export const permissionApi = {
  fetchPermissions,
  updatePermission,
  deletePermission,
  getPermissionById,
} as const;
