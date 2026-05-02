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
 * // Fetch entries
 * const result = await entryApi.find('posts', { page: 1, limit: 10 });
 * console.log(result.docs);       // Entry[]
 * console.log(result.totalDocs);  // Total count
 * console.log(result.hasNextPage); // boolean
 * ```
 */

import type { TableResponse } from "@revnixhq/ui";

import { fetcher } from "../lib/api/fetcher";
import { normalizePagination } from "../lib/api/normalizePagination";
import { protectedApi } from "../lib/api/protectedApi";
import type { ListResponse } from "../lib/api/response-types";
import type { Entry, EntryValue, FieldDefinition } from "../types/collection";

// ============================================================================
// Types
// ============================================================================

/**
 * Paginated response format
 */
export interface PaginatedDocs<T = Entry> {
  /** Array of documents */
  docs: T[];
  /** Total number of documents matching the query */
  totalDocs: number;
  /** Maximum number of documents per page */
  limit: number;
  /** Total number of pages */
  totalPages: number;
  /** Current page number (1-indexed) */
  page: number;
  /** Index of first document on current page (1-indexed) */
  pagingCounter: number;
  /** Whether there is a previous page */
  hasPrevPage: boolean;
  /** Whether there is a next page */
  hasNextPage: boolean;
  /** Previous page number, or null if on first page */
  prevPage: number | null;
  /** Next page number, or null if on last page */
  nextPage: number | null;
}

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

/**
 * Bulk operation result
 */
export interface BulkOperationResult<T = Entry> {
  docs: T[];
  errors: Array<{
    id?: string;
    message: string;
  }>;
}

// Phase 4 (Task 19): the LegacyPaginationMeta interface that mirrored the
// pre-canonical `{ total, page, pageSize, totalPages }` shape was removed
// because the dispatcher now emits canonical PaginationMeta exclusively
// (via respondList). The fetchEntries legacy adapter below still produces
// the pageSize-shaped output via normalizePagination so the table component
// keeps working.

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
 * Build paginated response
 */
function buildPaginatedDocs<T>(
  docs: T[],
  options: {
    totalDocs: number;
    page: number;
    limit: number;
  }
): PaginatedDocs<T> {
  const { totalDocs, page, limit } = options;
  const totalPages = Math.ceil(totalDocs / limit);

  return {
    docs,
    totalDocs,
    limit,
    totalPages,
    page,
    pagingCounter: (page - 1) * limit + 1,
    hasPrevPage: page > 1,
    hasNextPage: page < totalPages,
    prevPage: page > 1 ? page - 1 : null,
    nextPage: page < totalPages ? page + 1 : null,
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
   * console.log(result.docs);        // Entry[]
   * console.log(result.totalDocs);   // 42
   * console.log(result.hasNextPage); // true
   * console.log(result.nextPage);    // 2
   * ```
   */
  find: async (
    collectionSlug: string,
    params: FindParams = {}
  ): Promise<PaginatedDocs<Entry>> => {
    const query = buildFindQuery(params);
    let url = `/collections/${collectionSlug}/entries${query ? `?${query}` : ""}`;

    // Special handling for system 'users' collection
    if (collectionSlug === "users") {
      url = `/users${query ? `?${query}` : ""}`;
    }

    try {
      // Phase 4 (Task 19): server returns canonical `ListResponse<Entry>`
      // (`{ items, meta }`). The dispatcher emits `respondList(items, meta)`
      // for collection list endpoints (and the system /users alias).
      const result = await fetcher<ListResponse<Entry>>(url, {}, true);

      const page = params.page ?? 1;
      const limit = params.limit ?? 10;

      const docs = result.items;

      if (result.meta) {
        // Canonical meta carries `limit` (renamed from legacy `pageSize`).
        return buildPaginatedDocs(docs, {
          totalDocs: result.meta.total,
          page: result.meta.page,
          limit: result.meta.limit,
        });
      }

      // Fallback when meta is not provided
      return buildPaginatedDocs(docs, {
        totalDocs: docs.length,
        page,
        limit,
      });
    } catch (error: unknown) {
      // Fallback for Singles: valid URL but might be a Single, not a Collection
      // If the Collection API returns 404, try the Singles API
      const status = (error as Record<string, unknown> | undefined)?.status;
      if (status === 404 && collectionSlug !== "users") {
        try {
          // Phase 4 (Task 19): the singles getDocument endpoint returns the
          // bare document via respondDoc; type the fetcher generic with the
          // Entry shape directly.
          const singleUrl = `/singles/${collectionSlug}`;
          const singleResult = await fetcher<Entry>(singleUrl, {}, true);

          if (singleResult) {
            // Return as a "list" of 1 item
            return buildPaginatedDocs([singleResult], {
              totalDocs: 1,
              page: 1,
              limit: params.limit ?? 10,
            });
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
   * Bulk update entries with where clause
   *
   * @param collectionSlug - The collection identifier
   * @param params - Where clause to match entries
   * @param data - The data to update on all matched entries
   * @returns Bulk operation result
   *
   * @example
   * ```typescript
   * const result = await entryApi.updateMany('posts', {
   *   where: { status: { equals: 'draft' } },
   *   data: { status: 'archived' },
   * });
   * console.log(result.docs.length); // Number of updated entries
   * ```
   */
  updateMany: async (
    collectionSlug: string,
    params: {
      where: Record<string, unknown>;
      data: UpdateEntryPayload;
    }
  ): Promise<BulkOperationResult> => {
    // Phase 4 (Task 19): bulk operations are deferred to Phase 4.5. The
    // dispatcher still returns a CollectionServiceResult through the legacy
    // smart-extract path, so the wire body is the legacy `{ data, meta? }`
    // envelope (per routeHandler.ts:868). Peel `.data` here; this projection
    // disappears in Phase 4.5 once bulk endpoints adopt their own respondX
    // shape.
    const result = await protectedApi.patch<{ data: BulkOperationResult }>(
      `/collections/${collectionSlug}/entries`,
      params
    );
    return result.data;
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
   * Bulk delete entries with where clause
   *
   * @param collectionSlug - The collection identifier
   * @param params - Where clause to match entries
   * @returns Bulk operation result
   *
   * @example
   * ```typescript
   * const result = await entryApi.deleteMany('posts', {
   *   where: { status: { equals: 'archived' } },
   * });
   * console.log(result.docs.length); // Number of deleted entries
   * ```
   */
  deleteMany: async (
    collectionSlug: string,
    params: {
      where: Record<string, unknown>;
    }
  ): Promise<BulkOperationResult> => {
    // Phase 4 (Task 19): bulk-delete is on the legacy ServiceResult path
    // (Phase 4.5 will give it a canonical shape). Peel `.data` from the
    // legacy `{ data, meta? }` envelope until then.
    const result = await protectedApi.delete<{ data: BulkOperationResult }>(
      `/collections/${collectionSlug}/entries`,
      params
    );
    return result.data;
  },

  /**
   * Bulk delete entries by IDs (convenience method)
   *
   * @param collectionSlug - The collection identifier
   * @param ids - Array of entry IDs to delete
   * @returns Bulk operation result
   *
   * @example
   * ```typescript
   * const result = await entryApi.deleteByIDs('posts', ['id1', 'id2', 'id3']);
   * ```
   */
  deleteByIDs: async (
    collectionSlug: string,
    ids: string[]
  ): Promise<BulkOperationResult> => {
    // Phase 4 (Task 19): same legacy ServiceResult path as deleteMany. Peel
    // `.data` from the legacy envelope.
    const result = await protectedApi.delete<{ data: BulkOperationResult }>(
      `/collections/${collectionSlug}/entries`,
      {
        where: {
          id: { in: ids },
        },
      }
    );
    return result.data;
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
   * Fetch paginated entries for internal table component
   *
   * @deprecated Use `find` instead
   * @internal
   */
  fetchEntries: async (
    collectionSlug: string,
    params: FindParams = {}
  ): Promise<TableResponse<Entry>> => {
    const result = await entryApi.find(collectionSlug, params);

    const meta = normalizePagination(
      {
        page: result.page,
        pageSize: result.limit,
        total: result.totalDocs,
        totalPages: result.totalPages,
      },
      result.limit,
      result.docs.length
    );

    return { data: result.docs, meta };
  },

  /**
   * List all entries (non-paginated)
   *
   * @deprecated Use `find` with high limit instead
   * @internal
   */
  list: async (collectionSlug: string): Promise<Entry[]> => {
    const result = await entryApi.find(collectionSlug, { limit: 1000 });
    return result.docs;
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
