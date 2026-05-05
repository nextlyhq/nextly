import type { ListResponse, TableParams } from "@revnixhq/ui";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { fetcher } from "../lib/api/fetcher";
import type { MutationResponse } from "../lib/api/response-types";
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
 * Fetch permissions with pagination, search, and sorting. Maps
 * `items` through the toPermission shaper.
 */
export const fetchPermissions = async (
  params: TableParams
): Promise<ListResponse<Permission>> => {
  const query = buildQuery(params);
  const url = `/permissions${query ? `?${query}` : ""}`;

  const result = await fetcher<ListResponse<ApiPermissionEntry>>(url, {}, true);

  return {
    items: (result.items ?? []).map(toPermission),
    meta: result.meta,
  };
};

/**
 * Get a single permission by ID.
 */
export const getPermissionById = async (
  permissionId: string
): Promise<Permission> => {
  const result = await fetcher<ApiPermissionEntry>(
    `/permissions/${permissionId}`,
    {},
    true
  );

  return toPermission(result);
};

/**
 * Update a permission's fields. Re-fetches via getPermissionById
 * after the mutation to surface any server-derived fields the
 * MutationResponse body may not include.
 */
export const updatePermission = async (
  permissionId: string,
  updates: Partial<Permission>
): Promise<Permission> => {
  await fetcher<MutationResponse<ApiPermissionEntry>>(
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
 * Delete a permission by ID. Caller expects void; we discard the
 * response body.
 */
export const deletePermission = async (permissionId: string): Promise<void> => {
  await fetcher<MutationResponse<ApiPermissionEntry>>(
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
