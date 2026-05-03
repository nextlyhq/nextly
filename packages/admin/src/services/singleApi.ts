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

import type { ListResponse, TableParams } from "@revnixhq/ui";

import type { ApiSingle } from "@admin/types/entities";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { fetcher } from "../lib/api/fetcher";
import { protectedApi } from "../lib/api/protectedApi";
import type { MutationResponse } from "../lib/api/response-types";

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
 * Fetch Singles with pagination and filters.
 *
 * Phase 4.7: pass canonical ListResponse straight through. The legacy
 * normalizePagination adapter is gone.
 */
export const fetchSingles = async (
  params: TableParams
): Promise<ListResponse<ApiSingle>> => {
  const query = buildQuery(params);
  const url = `/singles${query ? `?${query}` : ""}`;
  return fetcher<ListResponse<ApiSingle>>(url, {}, true);
};

/**
 * Delete a Single by slug.
 *
 * Phase 4 (Task 19): server returns `ActionResponse` (delete is a non-CRUD
 * action in single-dispatcher because the registry returns void); we discard
 * the body since the caller expects void.
 */
export const deleteSingle = async (slug: string): Promise<void> => {
  // Use MutationResponse<unknown> as a generic shape. The dispatcher emits
  // either respondMutation (item) or respondAction ({ slug }), and we drop
  // the body in either case.
  await fetcher<MutationResponse<unknown>>(
    `/singles/${slug}`,
    {
      method: "DELETE",
    },
    true
  );
};

/**
 * Single API client object with all operations.
 *
 * Phase 4 (Task 19): the `protectedApi.*` calls below receive the raw
 * canonical body. List endpoints emit `ListResponse<T>`; bare reads (get,
 * getSchema, getDocument) return the doc directly; mutations return
 * `MutationResponse<T>`. We project the legacy shapes the existing callers
 * expect (bare arrays for `list`, `{ message, data }` for `create`, etc.).
 */
export const singleApi = {
  fetchSingles,
  deleteSingle,

  /**
   * List all Singles.
   */
  list: async (): Promise<ApiSingle[]> => {
    const result = await protectedApi.get<ListResponse<ApiSingle>>("/singles");
    return result.items;
  },

  /**
   * Get a Single by slug.
   */
  get: async (slug: string): Promise<ApiSingle> => {
    return protectedApi.get<ApiSingle>(`/singles/${slug}`);
  },

  /**
   * Get the schema for a Single.
   */
  getSchema: async (slug: string): Promise<ApiSingle> => {
    return protectedApi.get<ApiSingle>(`/singles/${slug}/schema`);
  },

  /**
   * Create a new Single.
   */
  create: async (
    payload: Partial<ApiSingle>
  ): Promise<{ message: string; data: ApiSingle }> => {
    const result = await protectedApi.post<MutationResponse<ApiSingle>>(
      "/singles",
      payload
    );
    // Preserve the legacy `{ message, data }` projection for callers; map
    // the canonical `item` field into `data`.
    return { message: result.message, data: result.item };
  },

  /**
   * Update an existing Single's schema/metadata.
   *
   * This updates the Single's schema definition (fields, label, description, admin options).
   * For updating the Single's document data (actual content values), use `updateDocument()`.
   */
  update: async (
    slug: string,
    payload: Partial<ApiSingle>
  ): Promise<{ message: string }> => {
    const result = await protectedApi.patch<MutationResponse<ApiSingle>>(
      `/singles/${slug}/schema`,
      payload
    );
    return { message: result.message };
  },

  /**
   * Remove a Single.
   */
  remove: async (slug: string): Promise<{ message: string }> => {
    // Single delete is a respondAction (`{ message, slug }`) in the
    // dispatcher; the message field is shared between mutation and action
    // shapes, so we type the broader MutationResponse and read `message`.
    const result = await protectedApi.delete<MutationResponse<unknown>>(
      `/singles/${slug}`
    );
    return { message: result.message };
  },

  // ============================================================
  // DOCUMENT OPERATIONS
  // These operate on the actual Single document data, not the schema
  // ============================================================

  /**
   * Get a Single's document data.
   *
   * Phase 4 (Task 19): the document endpoint returns the bare document
   * via respondDoc (not a list/mutation envelope).
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
   * Phase 4 (Task 19): server returns `MutationResponse<SingleDocument>`;
   * we project `result.item` so callers continue to receive the document
   * directly.
   */
  updateDocument: async (
    slug: string,
    data: Record<string, unknown>
  ): Promise<SingleDocument> => {
    const result = await protectedApi.patch<MutationResponse<SingleDocument>>(
      `/singles/${slug}`,
      data
    );
    return result.item;
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
