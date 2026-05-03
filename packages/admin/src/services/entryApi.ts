/**
 * Entry API Client
 *
 * Provides CRUD operations for collection entries.
 * This module handles all entry-related API calls for dynamic collections.
 *
 * @example
 * ```typescript
 * import { entryApi, entryKeys } from '@admin/services/entryApi';
 *
 * // Use query keys for caching
 * const queryKey = entryKeys.list('posts', { page: 1, limit: 10 });
 *
 * // Fetch entries (canonical ListResponse shape per spec section 5.1)
 * const result = await entryApi.find('posts', { page: 1, limit: 10 });
 * console.log(result.items);          // Entry[]
 * console.log(result.meta.total);     // Total count
 * console.log(result.meta.hasNext);   // boolean
 * ```
 */

import { fetcher } from "../lib/api/fetcher";
import { protectedApi } from "../lib/api/protectedApi";
import type { BulkResponse, ListResponse } from "../lib/api/response-types";
import type { Entry, EntryValue, FieldDefinition } from "../types/collection";

/**
 * Parameters for find operation
 */
export interface FindParams {
  /** Page number (1-indexed, default: 1) */
  page?: number;
  /** Number of documents per page (default: 10) */
  limit?: number;
  /** Sort field and direction (e.g., '-createdAt' for desc, 'title' for asc) */
  sort?: string;
  /** Search query string */
  search?: string;
  /** Query filters using Nextly where syntax */
  where?: Record<string, unknown>;
  /** Depth for relationship population (0-10) */
  depth?: number;
  /** Fields to select (reduces response size) */
  select?: Record<string, boolean>;
  /** Fields to populate for relationships */
  populate?: Record<string, boolean> | string[];
  /** Whether to include draft documents */
  draft?: boolean;
  /** Locale for localized fields */
  locale?: string;
  /** Fallback locale when translation is missing */
  fallbackLocale?: string;
}

/**
 * Parameters for count operation
 */
export interface CountParams {
  /** Query filters using Nextly where syntax */
  where?: Record<string, unknown>;
}

/**
 * Result of count operation
 */
export interface CountResult {
  totalDocs: number;
}

/**
 * Entry filter configuration for query keys
 */
export interface EntryFilters {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  where?: Record<string, unknown>;
  depth?: number;
}

/**
 * Extended entry type with field definitions for rendering
 * Note: This is a wrapper type that includes schema alongside entry data
 */
export interface EntryWithSchema {
  entry: Entry;
  schema?: {
    fields: FieldDefinition[];
  };
}

/**
 * Create entry payload
 */
export type CreateEntryPayload = Record<string, EntryValue>;

/**
 * Update entry payload (partial)
 */
export type UpdateEntryPayload = Record<string, EntryValue>;

// Phase 4.5: the local `BulkOperationResult` admin shape was deleted in
// favor of the canonical `BulkResponse<T>` from `lib/api/response-types`,
// which mirrors the server's respondBulk envelope `{ message, items, errors }`
// (errors[] carries `{ id, code, message }` per item, with `code` a
// canonical NextlyErrorCode string). Single source of truth + single
// round-trip + structured per-item failure surface.

// Phase 4.7: dropped the local PaginatedDocs envelope and the
// fetchEntries->TableResponse adapter; the find() method now returns
// canonical ListResponse directly. Consumers read result.items and
// result.meta.{total,page,limit,totalPages,hasNext,hasPrev} per spec
// section 5.1.

// ============================================================================
// Query Keys (TanStack Query v5 Pattern)
// ============================================================================

/**
 * Query key factory for entries
 *
 * Follows TanStack Query v5 best practices with hierarchical key structure.
 * Keys are organized from general to specific to enable precise cache invalidation.
 *
 * @example
 * ```typescript
 * // Invalidate all entries
 * queryClient.invalidateQueries({ queryKey: entryKeys.all });
 *
 * // Invalidate all lists for a collection
 * queryClient.invalidateQueries({ queryKey: entryKeys.lists('posts') });
 *
 * // Invalidate specific list with filters
 * queryClient.invalidateQueries({ queryKey: entryKeys.list('posts', { page: 1 }) });
 *
 * // Invalidate single entry
 * queryClient.invalidateQueries({ queryKey: entryKeys.detail('posts', 'entry-123') });
 *
 * // Invalidate count queries
 * queryClient.invalidateQueries({ queryKey: entryKeys.count('posts') });
 * ```
 */
export const entryKeys = {
  /** Base key for all entry queries */
  all: ["entries"] as const,

  /** Key for all list queries */
  lists: () => [...entryKeys.all, "list"] as const,

  /** Key for lists of a specific collection */
  listsByCollection: (collectionSlug: string) =>
    [...entryKeys.lists(), collectionSlug] as const,

  /** Key for a specific list query with filters */
  list: (collectionSlug: string, filters?: EntryFilters) =>
    [...entryKeys.listsByCollection(collectionSlug), filters ?? {}] as const,

  /** Key for all detail queries */
  details: () => [...entryKeys.all, "detail"] as const,

  /** Key for details of a specific collection */
  detailsByCollection: (collectionSlug: string) =>
    [...entryKeys.details(), collectionSlug] as const,

  /** Key for a specific entry detail */
  detail: (collectionSlug: string, id: string) =>
    [...entryKeys.detailsByCollection(collectionSlug), id] as const,

  /** Key for count queries */
  counts: () => [...entryKeys.all, "count"] as const,

  /** Key for count of a specific collection */
  count: (collectionSlug: string, where?: Record<string, unknown>) =>
    [...entryKeys.counts(), collectionSlug, where ?? {}] as const,
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Synthesize a canonical PaginationMeta when the upstream call did not
 * carry one (Singles fallback below, edge cases). Mirrors the math in
 * nextly's `respondList` helper so admin and server agree on the shape.
 */
function buildListMeta(options: {
  total: number;
  page: number;
  limit: number;
}): {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
} {
  const { total, page, limit } = options;
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Parse sort parameter into field and direction
 * Uses '-fieldName' for descending, 'fieldName' for ascending
 */
function parseSort(
  sort?: string
): { field: string; direction: "asc" | "desc" } | undefined {
  if (!sort) return undefined;

  if (sort.startsWith("-")) {
    return { field: sort.slice(1), direction: "desc" };
  }
  return { field: sort, direction: "asc" };
}

/**
 * Build query string for entry find requests
 */
export const buildFindQuery = (params: FindParams): string => {
  const query = new URLSearchParams();

  // Pagination (convert to backend format).
  // Phase 4 (Task 19): backend now reads `limit` (canonical name) instead of
  // the legacy `pageSize`. Send `limit` directly so we don't have to rename
  // again in Task 23 cleanup.
  if (params.page !== undefined) {
    query.set("page", String(params.page));
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }

  // Search
  if (params.search) {
    query.set("search", params.search);
  }

  // Sorting (-field for desc, field for asc)
  const sortInfo = parseSort(params.sort);
  if (sortInfo) {
    query.set("sortBy", sortInfo.field);
    query.set("sortOrder", sortInfo.direction);
  }

  // Depth for relationship population
  if (params.depth !== undefined) {
    query.set("depth", String(params.depth));
  }

  // Where clause (Nextly query syntax)
  if (params.where && Object.keys(params.where).length > 0) {
    query.set("where", JSON.stringify(params.where));
  }

  // Select fields
  if (params.select && Object.keys(params.select).length > 0) {
    query.set("select", JSON.stringify(params.select));
  }

  // Populate fields
  if (params.populate) {
    if (Array.isArray(params.populate)) {
      query.set("populate", JSON.stringify(params.populate));
    } else if (Object.keys(params.populate).length > 0) {
      query.set("populate", JSON.stringify(params.populate));
    }
  }

  // Draft mode
  if (params.draft !== undefined) {
    query.set("draft", String(params.draft));
  }

  // Locale
  if (params.locale) {
    query.set("locale", params.locale);
  }
  if (params.fallbackLocale) {
    query.set("fallbackLocale", params.fallbackLocale);
  }

  return query.toString();
};

// ============================================================================
// API Functions
// ============================================================================

/**
 * Entry API client
 *
 * @example
 * ```typescript
 * // Find entries with pagination
 * const result = await entryApi.find('posts', {
 *   page: 1,
 *   limit: 10,
 *   sort: '-createdAt',
 *   where: { status: { equals: 'published' } },
 * });
 *
 * // Find single entry by ID
 * const post = await entryApi.findByID('posts', 'abc123');
 *
 * // Create entry
 * const newPost = await entryApi.create('posts', { title: 'Hello' });
 *
 * // Update entry
 * const updated = await entryApi.update('posts', 'abc123', { title: 'Updated' });
 *
 * // Delete entry
 * await entryApi.delete('posts', 'abc123');
 *
 * // Count entries
 * const count = await entryApi.count('posts', { where: { status: { equals: 'published' } } });
 * ```
 */
export const entryApi = {
  /**
   * Find entries with pagination and filtering
   *
   * @param collectionSlug - The collection identifier
   * @param params - Query parameters
   * @returns Paginated response with docs and metadata
   *
   * @example
   * ```typescript
   * const result = await entryApi.find('posts', {
   *   page: 1,
   *   limit: 10,
   *   sort: '-createdAt',
   *   where: { status: { equals: 'published' } },
   *   depth: 2,
   * });
   *
   * console.log(result.items);          // Entry[]
   * console.log(result.meta.total);     // 42
   * console.log(result.meta.hasNext);   // true
   * ```
   */
  find: async (
    collectionSlug: string,
    params: FindParams = {}
  ): Promise<ListResponse<Entry>> => {
    const query = buildFindQuery(params);
    let url = `/collections/${collectionSlug}/entries${query ? `?${query}` : ""}`;

    // Special handling for system 'users' collection
    if (collectionSlug === "users") {
      url = `/users${query ? `?${query}` : ""}`;
    }

    try {
      // Server returns canonical ListResponse<Entry> via respondList.
      const result = await fetcher<ListResponse<Entry>>(url, {}, true);

      if (result.meta) {
        return result;
      }

      // Fallback when meta is missing (defensive: dispatchers always emit
      // it post-Phase-4, but synthesize one if a custom handler skipped it).
      const page = params.page ?? 1;
      const limit = params.limit ?? 10;
      return {
        items: result.items,
        meta: buildListMeta({ total: result.items.length, page, limit }),
      };
    } catch (error: unknown) {
      // Fallback for Singles: valid URL but might be a Single, not a Collection.
      // If the Collection API returns 404, try the Singles API and project
      // the bare doc into a single-item list.
      const status = (error as Record<string, unknown> | undefined)?.status;
      if (status === 404 && collectionSlug !== "users") {
        try {
          const singleUrl = `/singles/${collectionSlug}`;
          const singleResult = await fetcher<Entry>(singleUrl, {}, true);

          if (singleResult) {
            return {
              items: [singleResult],
              meta: buildListMeta({
                total: 1,
                page: 1,
                limit: params.limit ?? 10,
              }),
            };
          }
        } catch (singleError) {
          // If both fail, throw the original error (Collection not found)
          console.warn(
            "Failed to fetch as single after collection failure",
            singleError
          );
        }
      }
      throw error;
    }
  },

  /**
   * Find a single entry by ID
   *
   * @param collectionSlug - The collection identifier
   * @param id - The entry ID
   * @param options - Optional parameters (depth, locale, etc.)
   * @returns The entry data
   *
   * @example
   * ```typescript
   * const post = await entryApi.findByID('posts', 'abc123', { depth: 2 });
   * ```
   */
  findByID: async (
    collectionSlug: string,
    id: string,
    options?: Pick<FindParams, "depth" | "locale" | "fallbackLocale" | "draft">
  ): Promise<Entry> => {
    const query = new URLSearchParams();
    if (options?.depth !== undefined) query.set("depth", String(options.depth));
    if (options?.locale) query.set("locale", options.locale);
    if (options?.fallbackLocale)
      query.set("fallbackLocale", options.fallbackLocale);
    if (options?.draft !== undefined) query.set("draft", String(options.draft));

    const queryString = query.toString();

    // Special handling for system 'users' collection
    let url;
    if (collectionSlug === "users") {
      url = `/users/${id}${queryString ? `?${queryString}` : ""}`;
    } else {
      url = `/collections/${collectionSlug}/entries/${id}${queryString ? `?${queryString}` : ""}`;
    }

    try {
      return await protectedApi.get<Entry>(url);
    } catch (error: unknown) {
      // Fallback for Singles
      const status = (error as Record<string, unknown> | undefined)?.status;
      if (status === 404 && collectionSlug !== "users") {
        try {
          // Try fetching as a Single (id is ignored/redundant as slug defines it)
          const singleUrl = `/singles/${collectionSlug}`;
          return await protectedApi.get<Entry>(singleUrl);
        } catch (_singleError) {
          // Ignore
        }
      }
      throw error;
    }
  },

  /**
   * Count entries matching criteria
   *
   * @param collectionSlug - The collection identifier
   * @param params - Count parameters with optional where clause
   * @returns Count result
   *
   * @example
   * ```typescript
   * const result = await entryApi.count('posts', {
   *   where: { status: { equals: 'published' } },
   * });
   * console.log(result.totalDocs); // 42
   * ```
   */
  count: async (
    collectionSlug: string,
    params: CountParams = {}
  ): Promise<CountResult> => {
    const query = new URLSearchParams();
    if (params.where && Object.keys(params.where).length > 0) {
      query.set("where", JSON.stringify(params.where));
    }

    const queryString = query.toString();
    const url = `/collections/${collectionSlug}/entries/count${queryString ? `?${queryString}` : ""}`;

    // Phase 4 (Task 19): server emits canonical `respondCount(total)`
    // (`{ total }`). The legacy admin contract surfaces the count as
    // `{ totalDocs }`, so we map the canonical field to the existing key
    // without renaming the public CountResult type used by callers.
    const result = await protectedApi.get<{ total: number }>(url);
    return { totalDocs: result.total };
  },

  /**
   * Create a new entry
   *
   * @param collectionSlug - The collection identifier
   * @param data - The entry data
   * @returns The created entry
   *
   * @example
   * ```typescript
   * const newPost = await entryApi.create('posts', {
   *   title: 'Hello World',
   *   content: 'This is my first post',
   *   status: 'draft',
   * });
   * ```
   */
  create: async (
    collectionSlug: string,
    data: CreateEntryPayload
  ): Promise<Entry> => {
    // Phase 4 (Task 19): server returns `MutationResponse<Entry>`
    // (`{ message, item }`); existing callers expect a bare Entry, so we
    // project `item`.
    const result = await protectedApi.post<{ message: string; item: Entry }>(
      `/collections/${collectionSlug}/entries`,
      data
    );
    return result.item;
  },

  /**
   * Update an entry by ID
   *
   * @param collectionSlug - The collection identifier
   * @param id - The entry ID
   * @param data - The partial entry data to update
   * @returns The updated entry
   *
   * @example
   * ```typescript
   * const updated = await entryApi.update('posts', 'abc123', {
   *   title: 'Updated Title',
   *   status: 'published',
   * });
   * ```
   */
  update: async (
    collectionSlug: string,
    id: string,
    data: UpdateEntryPayload
  ): Promise<Entry> => {
    // Phase 4 (Task 19): mutations return `MutationResponse<Entry>`; project
    // `item` to keep the bare-Entry public signature.
    const result = await protectedApi.patch<{ message: string; item: Entry }>(
      `/collections/${collectionSlug}/entries/${id}`,
      data
    );
    return result.item;
  },

  /**
   * Bulk update entries matching a where clause (Phase 4.5).
   *
   * Hits `PATCH /api/collections/{slug}/entries` (server `bulkUpdateByQuery`).
   * Single round-trip; server runs per-row updates concurrently with full
   * hook + access-control pipeline; partial failures returned in `errors[]`.
   *
   * @param collectionSlug - The collection identifier
   * @param params - Where clause + data to update
   * @returns BulkResponse<Entry> with successful records in `items` and
   *          structured `errors[]` (each `{ id, code, message }`)
   *
   * @example
   * ```typescript
   * const result = await entryApi.updateMany('posts', {
   *   where: { status: { equals: 'draft' } },
   *   data: { status: 'archived' },
   * });
   * toast(result.message);
   * console.log(result.items.length, 'updated');
   * console.log(result.errors.length, 'failed');
   * ```
   */
  updateMany: async (
    collectionSlug: string,
    params: {
      where: Record<string, unknown>;
      data: UpdateEntryPayload;
    }
  ): Promise<BulkResponse<Entry>> => {
    return protectedApi.patch<BulkResponse<Entry>>(
      `/collections/${collectionSlug}/entries`,
      params
    );
  },

  /**
   * Bulk update entries by id list (Phase 4.5).
   *
   * Hits `POST /api/collections/{slug}/entries/bulk-update` (server
   * `bulkUpdateEntries`). Same shape as updateMany; preferred when the
   * caller already has a list of ids (e.g. multi-select in admin tables).
   *
   * @param collectionSlug - The collection identifier
   * @param params - Array of ids + data to update on each
   * @returns BulkResponse<Entry>
   *
   * @example
   * ```typescript
   * const result = await entryApi.updateByIDs('posts', {
   *   ids: ['id1', 'id2'],
   *   data: { status: 'published' },
   * });
   * ```
   */
  updateByIDs: async (
    collectionSlug: string,
    params: {
      ids: string[];
      data: UpdateEntryPayload;
    }
  ): Promise<BulkResponse<Entry>> => {
    return protectedApi.post<BulkResponse<Entry>>(
      `/collections/${collectionSlug}/entries/bulk-update`,
      params
    );
  },

  /**
   * Delete an entry by ID
   *
   * @param collectionSlug - The collection identifier
   * @param id - The entry ID
   * @returns The deleted entry
   *
   * @example
   * ```typescript
   * const deleted = await entryApi.delete('posts', 'abc123');
   * ```
   */
  delete: async (collectionSlug: string, id: string): Promise<Entry> => {
    // Phase 4 (Task 19): mutations return `MutationResponse<Entry>`; project
    // `item` so callers continue to receive the deleted entry.
    const result = await protectedApi.delete<{ message: string; item: Entry }>(
      `/collections/${collectionSlug}/entries/${id}`
    );
    return result.item;
  },

  /**
   * Bulk delete entries by id list (Phase 4.5).
   *
   * Hits `POST /api/collections/{slug}/entries/bulk-delete` (server
   * `bulkDeleteEntries`). Single round-trip; server runs per-row deletes
   * concurrently with full hook + access-control pipeline; partial
   * failures returned in `errors[]`.
   *
   * `items` contains `[{id}, ...]` for the successfully deleted ids
   * (no full record, since the entries are gone).
   *
   * @param collectionSlug - The collection identifier
   * @param ids - Array of entry IDs to delete
   * @returns BulkResponse<{ id: string }>
   *
   * @example
   * ```typescript
   * const result = await entryApi.deleteByIDs('posts', ['id1', 'id2']);
   * toast(result.message);
   * if (result.errors.length > 0) {
   *   // Surface per-item failures; each has { id, code, message }.
   * }
   * ```
   */
  deleteByIDs: async (
    collectionSlug: string,
    ids: string[]
  ): Promise<BulkResponse<{ id: string }>> => {
    return protectedApi.post<BulkResponse<{ id: string }>>(
      `/collections/${collectionSlug}/entries/bulk-delete`,
      { ids }
    );
  },

  /**
   * Duplicate an existing entry (creates a copy)
   *
   * Creates a new entry with the same field values as the source entry.
   * System fields (id, createdAt, updatedAt) and unique fields (slug) are
   * automatically handled by the backend. Title/name fields get " (Copy)" appended.
   *
   * @param collectionSlug - The collection identifier
   * @param id - The ID of the entry to duplicate
   * @param overrides - Optional field overrides for the duplicated entry
   * @returns The newly created duplicate entry
   *
   * @example
   * ```typescript
   * // Simple duplication
   * const duplicate = await entryApi.duplicate('posts', 'abc123');
   *
   * // With field overrides
   * const duplicate = await entryApi.duplicate('posts', 'abc123', {
   *   title: 'Custom Title',
   *   status: 'draft',
   * });
   * ```
   */
  duplicate: async (
    collectionSlug: string,
    id: string,
    overrides?: Record<string, unknown>
  ): Promise<Entry> => {
    // Phase 4 (Task 19): duplicate emits `respondMutation(message, entry, 201)`;
    // peel `item` from the canonical envelope to keep the bare-Entry public
    // signature.
    const result = await protectedApi.post<{ message: string; item: Entry }>(
      `/collections/${collectionSlug}/entries/${id}/duplicate`,
      overrides ? { overrides } : {}
    );
    return result.item;
  },

  // ===========================================================================
  // Legacy Methods (for backwards compatibility with internal table components)
  // ===========================================================================

  /**
   * List all entries (non-paginated)
   *
   * @deprecated Use `find` with high limit instead
   * @internal
   */
  list: async (collectionSlug: string): Promise<Entry[]> => {
    const result = await entryApi.find(collectionSlug, { limit: 1000 });
    return result.items;
  },

  /**
   * Get single entry by ID
   *
   * @deprecated Use `findByID` instead
   * @internal
   */
  get: async (collectionSlug: string, entryId: string): Promise<Entry> => {
    return entryApi.findByID(collectionSlug, entryId);
  },
} as const;
