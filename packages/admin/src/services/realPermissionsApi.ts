import { enhancedFetcher } from "../lib/api/enhancedFetcher";

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

interface PermissionListMeta {
  total: number;
  page: number;
  pageSize: number;
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
  pageSize?: number;
  page?: number;
}): Promise<PermissionListResult> => {
  const params = new URLSearchParams();

  if (options?.search) params.set("search", options.search);
  if (options?.resource) params.set("resource", options.resource);
  if (options?.action) params.set("action", options.action);
  params.set("pageSize", String(options?.pageSize ?? 200));
  params.set("page", String(options?.page ?? 1));
  params.set("sortBy", "resource");
  params.set("sortOrder", "asc");

  const query = params.toString();
  const result = await enhancedFetcher<
    ApiPermissionEntry[],
    PermissionListMeta
  >(`/permissions${query ? `?${query}` : ""}`, {}, true);

  return {
    data: result.data ?? [],
    meta: result.meta ?? {
      total: 0,
      page: 1,
      pageSize: 200,
      totalPages: 0,
    },
  };
};
