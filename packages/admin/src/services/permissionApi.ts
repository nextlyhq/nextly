import type { TableParams, TableResponse } from "@revnixhq/ui";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { fetcher } from "../lib/api/fetcher";
import { normalizePagination } from "../lib/api/normalizePagination";
import type { ListResponse, MutationResponse } from "../lib/api/response-types";
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
 * Fetch permissions with pagination, search, and sorting.
 *
 * Phase 4 (Task 19): server returns `ListResponse<ApiPermissionEntry>`
 * (`{ items, meta }`); we map to the table-component shape locally.
 */
export const fetchPermissions = async (
  params: TableParams
): Promise<TableResponse<Permission>> => {
  const query = buildQuery(params);
  const url = `/permissions${query ? `?${query}` : ""}`;

  const result = await fetcher<ListResponse<ApiPermissionEntry>>(url, {}, true);

  const data = (result.items ?? []).map(toPermission);
  const { pageSize } = params.pagination;
  const meta = normalizePagination(result.meta, pageSize, data.length);

  return { data, meta };
};

/**
 * Get a single permission by ID.
 *
 * Phase 4 (Task 19): findByID returns the bare doc via respondDoc.
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
 * Update a permission's fields.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<ApiPermissionEntry>`;
 * we still re-fetch via getPermissionById to surface any server-derived
 * fields the mutation result may not include.
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
 * Delete a permission by ID.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<ApiPermissionEntry>`;
 * we discard the body.
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
