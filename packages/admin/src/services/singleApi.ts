/**
 * Single API Service
 *
 * API client for Single (Global) operations. Follows the same pattern as collectionApi.ts.
 *
 * This module provides two types of operations:
 * 1. **Schema/Metadata operations** - CRUD operations on Single definitions (fields, labels, etc.)
 * 2. **Document operations** - Read/update operations on Single document data (the actual content)
 *
 * @module services/singleApi
 */

import type { TableParams, TableResponse } from "@revnixhq/ui";

import type { ApiSingle } from "@admin/types/entities";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { enhancedFetcher } from "../lib/api/enhancedFetcher";
import { normalizePagination } from "../lib/api/normalizePagination";
import { protectedApi } from "../lib/api/protectedApi";

/**
 * Build query string for pagination and search using shared utility
 */
const buildQuery = (params: TableParams): string => {
  return buildQueryUtil(params, {
    fieldMapping: {
      slug: "slug",
      label: "label",
      source: "source",
      createdAt: "createdAt",
    },
    validSortFields: ["slug", "label", "source", "createdAt"],
  });
};

/**
 * Fetch Singles with pagination and filters
 *
 * @param params - Table parameters for pagination, search, and sorting
 * @returns Promise with Singles data and pagination meta
 */
export const fetchSingles = async (
  params: TableParams
): Promise<TableResponse<ApiSingle>> => {
  const query = buildQuery(params);
  const url = `/singles${query ? `?${query}` : ""}`;

  const result = await enhancedFetcher<ApiSingle[], Record<string, unknown>>(
    url,
    {},
    true
  );

  const singles = result.data;
  const { pageSize = 10 } = params.pagination;
  const meta = normalizePagination(result.meta, pageSize, singles.length);

  return { data: singles, meta };
};

/**
 * Delete a Single by slug
 *
 * @param slug - The slug of the Single to delete
 */
export const deleteSingle = async (slug: string): Promise<void> => {
  await enhancedFetcher<null>(
    `/singles/${slug}`,
    {
      method: "DELETE",
    },
    true
  );
};

/**
 * Single API client object with all operations
 */
export const singleApi = {
  fetchSingles,
  deleteSingle,

  /**
   * List all Singles
   */
  list: async (): Promise<ApiSingle[]> => {
    return protectedApi.get<ApiSingle[]>("/singles");
  },

  /**
   * Get a Single by slug
   *
   * @param slug - The unique slug of the Single
   */
  get: async (slug: string): Promise<ApiSingle> => {
    return protectedApi.get<ApiSingle>(`/singles/${slug}`);
  },

  /**
   * Get the schema for a Single
   *
   * @param slug - The unique slug of the Single
   */
  getSchema: async (slug: string): Promise<ApiSingle> => {
    return protectedApi.get<ApiSingle>(`/singles/${slug}/schema`);
  },

  /**
   * Create a new Single
   *
   * @param payload - Single creation payload
   */
  create: async (
    payload: Partial<ApiSingle>
  ): Promise<{ message: string; data: ApiSingle }> => {
    return protectedApi.post<{ message: string; data: ApiSingle }>(
      "/singles",
      payload
    );
  },

  /**
   * Update an existing Single's schema/metadata
   *
   * This updates the Single's schema definition (fields, label, description, admin options).
   * For updating the Single's document data (actual content values), use `updateDocument()`.
   *
   * @param slug - The slug of the Single to update
   * @param payload - Update payload (label, description, fields, admin)
   */
  update: async (
    slug: string,
    payload: Partial<ApiSingle>
  ): Promise<{ message: string }> => {
    return protectedApi.patch<{ message: string }>(
      `/singles/${slug}/schema`,
      payload
    );
  },

  /**
   * Remove a Single
   *
   * @param slug - The slug of the Single to remove
   */
  remove: async (slug: string): Promise<{ message: string }> => {
    return protectedApi.delete<{ message: string }>(`/singles/${slug}`);
  },

  // ============================================================
  // DOCUMENT OPERATIONS
  // These operate on the actual Single document data, not the schema
  // ============================================================

  /**
   * Get a Single's document data.
   *
   * This fetches the actual content/values of the Single, not the schema.
   * If the document doesn't exist, it will be auto-created with default values.
   *
   * Note: The API endpoint `/api/singles/[slug]` returns document data by default.
   * For schema/metadata, use `getSchema()` which calls `/api/singles/[slug]/schema`.
   *
   * @param slug - The unique slug of the Single
   * @param options - Optional parameters (depth for relationship expansion)
   * @returns The Single document data
   *
   * @example
   * ```ts
   * const doc = await singleApi.getDocument('site-settings');
   * console.log(doc.siteName); // "My Site"
   * ```
   */
  getDocument: async (
    slug: string,
    options?: { depth?: number }
  ): Promise<SingleDocument> => {
    const params = new URLSearchParams();
    if (options?.depth !== undefined) {
      params.set("depth", String(options.depth));
    }
    const query = params.toString();
    // The /singles/[slug] endpoint returns document data
    const url = `/singles/${slug}${query ? `?${query}` : ""}`;
    return protectedApi.get<SingleDocument>(url);
  },

  /**
   * Update a Single's document data.
   *
   * This updates the actual content/values of the Single.
   * If the document doesn't exist, it will be auto-created first.
   *
   * @param slug - The unique slug of the Single
   * @param data - The document data to update
   * @returns The updated Single document
   *
   * @example
   * ```ts
   * const updated = await singleApi.updateDocument('site-settings', {
   *   siteName: 'My New Site Name',
   *   tagline: 'Building the future',
   * });
   * ```
   */
  updateDocument: async (
    slug: string,
    data: Record<string, unknown>
  ): Promise<SingleDocument> => {
    // The /singles/[slug] endpoint with PATCH updates document data
    return protectedApi.patch<SingleDocument>(`/singles/${slug}`, data);
  },
} as const;

// ============================================================
// Types
// ============================================================

/**
 * Single document data - the actual content stored in a Single.
 * This is distinct from ApiSingle which represents the schema/metadata.
 */
export interface SingleDocument {
  /** Unique document ID */
  id: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Dynamic field values based on Single schema */
  [key: string]: unknown;
}
