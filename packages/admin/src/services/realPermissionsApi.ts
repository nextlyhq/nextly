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
  /**
   * The plugin that owns this permission, or null for one the seeder owns.
   *
   * Provenance rather than a naming convention: a plugin names its own
   * resource, so a permission cannot be attributed by inspecting its resource
   * string. This is the field that decides which plugin a permission belongs
   * to, and it is what the rows record — as opposed to what a configuration
   * declares, which cannot see Schema Builder entities at all.
   */
  owner: string | null;
  /**
   * Heading within the owner's section; null when the owner set none.
   *
   * Named for the field the endpoint SERIALIZES. `PermissionService`
   * `listPermissions` maps its columns to `group` and `orphaned` and returns
   * that result directly, so a DTO naming the column instead would declare
   * properties that never cross the wire — always `undefined` at runtime, while
   * hiding the ones that do arrive.
   */
  group: string | null;
  /** True once the declaring package stopped declaring it. */
  orphaned: boolean;
  /** True for a permission the admin should warn before granting. */
  danger: boolean;
  /** Grouping label the settings page reads; absent unless the row sets one. */
  category?: string;
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
