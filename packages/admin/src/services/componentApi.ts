/**
 * Component API Service
 *
 * API client for Component definition management operations.
 * Follows the established pattern from collectionApi.ts.
 *
 * @see collectionApi.ts - Reference pattern
 */

import type { TableParams, TableResponse } from "@revnixhq/ui";

import type { ApiComponent } from "@admin/types/entities";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { fetcher } from "../lib/api/fetcher";
import { normalizePagination } from "../lib/api/normalizePagination";
import { protectedApi } from "../lib/api/protectedApi";
import type { ListResponse, MutationResponse } from "../lib/api/response-types";

/**
 * Payload for creating a new Component via API
 */
export interface CreateComponentPayload {
  slug: string;
  label: string;
  description?: string;
  fields: Record<string, unknown>[];
  admin?: {
    category?: string;
    icon?: string;
    hidden?: boolean;
    description?: string;
    imageURL?: string;
  };
}

/**
 * Payload for updating an existing Component via API
 */
export interface UpdateComponentPayload {
  label?: string;
  description?: string;
  fields?: Record<string, unknown>[];
  admin?: {
    category?: string;
    icon?: string;
    hidden?: boolean;
    description?: string;
    imageURL?: string;
  };
}

// Build query string for pagination and search using shared utility
const buildQuery = (params: TableParams): string => {
  return buildQueryUtil(params, {
    fieldMapping: {
      slug: "slug",
      label: "label",
      source: "source",
      createdAt: "createdAt",
    },
    validSortFields: ["slug", "label", "createdAt"],
  });
};

/**
 * Fetch paginated list of Component definitions.
 *
 * Phase 4 (Task 19): server returns `ListResponse<ApiComponent>`
 * (`{ items, meta }`); we map to the table-component shape locally.
 */
export const fetchComponents = async (
  params: TableParams
): Promise<TableResponse<ApiComponent>> => {
  const query = buildQuery(params);
  const url = `/components${query ? `?${query}` : ""}`;

  const result = await fetcher<ListResponse<ApiComponent>>(url, {}, true);

  const components = result.items;
  const { pageSize = 10 } = params.pagination;
  const meta = normalizePagination(result.meta, pageSize, components.length);

  return { data: components, meta };
};

/**
 * Delete a Component definition by slug.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<ApiComponent>` or
 * `ActionResponse` (delete may be either depending on whether the dispatcher
 * surfaces the deleted record); we discard the body.
 */
export const deleteComponent = async (componentSlug: string): Promise<void> => {
  await fetcher<MutationResponse<unknown>>(
    `/components/${componentSlug}`,
    {
      method: "DELETE",
    },
    true
  );
};

/**
 * Component API service object.
 *
 * Phase 4 (Task 19): list returns `ListResponse<T>`; bare reads return the
 * doc directly; create/update return `MutationResponse<T>`. We preserve
 * the legacy `{ data: ApiComponent }` projection for create/update because
 * the existing callers destructure `data`.
 */
export const componentApi = {
  fetchComponents,
  deleteComponent,

  /**
   * List all Component definitions (simple list, no pagination).
   */
  list: async (): Promise<ApiComponent[]> => {
    const result =
      await protectedApi.get<ListResponse<ApiComponent>>("/components");
    return result.items;
  },

  /**
   * Get a single Component definition by slug.
   */
  get: async (componentSlug: string): Promise<ApiComponent> => {
    return protectedApi.get<ApiComponent>(`/components/${componentSlug}`);
  },

  /**
   * Create a new Component definition.
   */
  create: async (
    payload: CreateComponentPayload
  ): Promise<{ data: ApiComponent }> => {
    const result = await protectedApi.post<MutationResponse<ApiComponent>>(
      "/components",
      payload
    );
    // Map canonical `item` to legacy `data` projection.
    return { data: result.item };
  },

  /**
   * Update an existing Component definition.
   */
  update: async (
    componentSlug: string,
    payload: UpdateComponentPayload
  ): Promise<{ data: ApiComponent }> => {
    const result = await protectedApi.patch<MutationResponse<ApiComponent>>(
      `/components/${componentSlug}`,
      payload
    );
    return { data: result.item };
  },

  /**
   * Remove a Component definition.
   */
  remove: async (componentSlug: string): Promise<{ message: string }> => {
    const result = await protectedApi.delete<MutationResponse<ApiComponent>>(
      `/components/${componentSlug}`
    );
    return { message: result.message };
  },
} as const;
