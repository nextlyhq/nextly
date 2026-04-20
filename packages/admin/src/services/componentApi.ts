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
import { enhancedFetcher } from "../lib/api/enhancedFetcher";
import { normalizePagination } from "../lib/api/normalizePagination";
import { protectedApi } from "../lib/api/protectedApi";

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
 * Fetch paginated list of Component definitions
 *
 * @param params - Table parameters for pagination, search, and sorting
 * @returns Promise with Component list and pagination metadata
 */
export const fetchComponents = async (
  params: TableParams
): Promise<TableResponse<ApiComponent>> => {
  const query = buildQuery(params);
  const url = `/components${query ? `?${query}` : ""}`;

  const result = await enhancedFetcher<ApiComponent[], Record<string, unknown>>(
    url,
    {},
    true
  );

  const components = result.data;
  const { pageSize = 10 } = params.pagination;
  const meta = normalizePagination(result.meta, pageSize, components.length);

  return { data: components, meta };
};

/**
 * Delete a Component definition by slug
 *
 * @param componentSlug - The unique slug of the Component to delete
 */
export const deleteComponent = async (componentSlug: string): Promise<void> => {
  await enhancedFetcher<null>(
    `/components/${componentSlug}`,
    {
      method: "DELETE",
    },
    true
  );
};

/**
 * Component API service object
 */
export const componentApi = {
  fetchComponents,
  deleteComponent,

  /**
   * List all Component definitions (simple list, no pagination)
   */
  list: async (): Promise<ApiComponent[]> => {
    return protectedApi.get<ApiComponent[]>("/components");
  },

  /**
   * Get a single Component definition by slug
   */
  get: async (componentSlug: string): Promise<ApiComponent> => {
    return protectedApi.get<ApiComponent>(`/components/${componentSlug}`);
  },

  /**
   * Create a new Component definition
   */
  create: async (
    payload: CreateComponentPayload
  ): Promise<{ data: ApiComponent }> => {
    return protectedApi.post<{ data: ApiComponent }>("/components", payload);
  },

  /**
   * Update an existing Component definition
   */
  update: async (
    componentSlug: string,
    payload: UpdateComponentPayload
  ): Promise<{ data: ApiComponent }> => {
    return protectedApi.patch<{ data: ApiComponent }>(
      `/components/${componentSlug}`,
      payload
    );
  },

  /**
   * Remove a Component definition
   */
  remove: async (componentSlug: string): Promise<{ message: string }> => {
    return protectedApi.delete<{ message: string }>(
      `/components/${componentSlug}`
    );
  },
} as const;
