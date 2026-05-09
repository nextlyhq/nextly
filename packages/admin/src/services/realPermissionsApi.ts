import { fetcher } from "../lib/api/fetcher";
import type { ListResponse } from "../lib/api/response-types";

/**
 * Real permission entry shape from the backend.
 * Distinct from the mock `Permission` type in `entities.ts` which is UI-specific.
 */
export interface ApiPermissionEntry {
  id: string;
  name: string;
  slug: string;
  action: string;
  resource: string;
  description: string | null;
}

// Canonical pagination meta is { total, page, limit, totalPages, hasNext,
// hasPrev } per spec §5.1. Consumers read `limit`.
interface PermissionListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PermissionListResult {
  data: ApiPermissionEntry[];
  meta: PermissionListMeta;
}

/**
 * Fetch permissions from the real backend API.
 *
 * Supports optional search, resource filter, action filter, and page size.
 * Defaults to fetching up to 200 permissions sorted by resource (suitable
 * for the Permissions Overview page which groups by resource client-side).
 */
export const fetchPermissionsFromApi = async (options?: {
  search?: string;
  resource?: string;
  action?: string;
  limit?: number;
  page?: number;
}): Promise<PermissionListResult> => {
  const params = new URLSearchParams();

  if (options?.search) params.set("search", options.search);
  if (options?.resource) params.set("resource", options.resource);
  if (options?.action) params.set("action", options.action);
  params.set("limit", String(options?.limit ?? 200));
  params.set("page", String(options?.page ?? 1));
  params.set("sortBy", "resource");
  params.set("sortOrder", "asc");

  const query = params.toString();
  const result = await fetcher<ListResponse<ApiPermissionEntry>>(
    `/permissions${query ? `?${query}` : ""}`,
    {},
    true
  );

  return {
    data: result.items ?? [],
    meta: result.meta ?? {
      total: 0,
      page: 1,
      limit: 200,
      totalPages: 0,
    },
  };
};
