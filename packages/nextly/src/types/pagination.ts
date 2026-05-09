/**
 * Pagination Types
 *
 * Provides pagination response types and utilities.
 */

/**
 * Standard paginated response format.
 *
 * This interface defines the response structure returned for all
 * paginated queries.
 *
 * @template T - The type of documents in the response
 *
 * @example
 * ```typescript
 * const response: PaginatedResponse<Post> = {
 *   docs: [{ id: '1', title: 'Hello' }],
 *   totalDocs: 100,
 *   limit: 10,
 *   totalPages: 10,
 *   page: 1,
 *   pagingCounter: 1,
 *   hasPrevPage: false,
 *   hasNextPage: true,
 *   prevPage: null,
 *   nextPage: 2,
 * };
 * ```
 */
export interface PaginatedResponse<T> {
  /** Array of documents for the current page */
  docs: T[];

  /** Total number of documents matching the query */
  totalDocs: number;

  /** Maximum number of documents per page */
  limit: number;

  /** Total number of pages available */
  totalPages: number;

  /** Current page number (1-indexed) */
  page: number;

  /**
   * Index of the first document on the current page (1-indexed).
   * For example, on page 2 with limit 10, pagingCounter would be 11.
   */
  pagingCounter: number;

  /** Whether there is a previous page */
  hasPrevPage: boolean;

  /** Whether there is a next page */
  hasNextPage: boolean;

  /** Previous page number, or null if on the first page */
  prevPage: number | null;

  /** Next page number, or null if on the last page */
  nextPage: number | null;
}

/**
 * Options for building a paginated response.
 */
export interface BuildPaginatedResponseOptions {
  /** Total number of documents matching the query (before pagination) */
  total: number;

  /** Current page number (1-indexed) */
  page: number;

  /** Number of documents per page */
  limit: number;
}

/**
 * Default pagination values.
 */
export const PAGINATION_DEFAULTS = {
  /** Default page number */
  page: 1,

  /** Default number of documents per page */
  limit: 10,

  /** Maximum allowed limit to prevent abuse */
  maxLimit: 500,
} as const;

/**
 * Builds a complete paginated response from documents and pagination options.
 *
 * This utility function calculates all pagination metadata fields
 * based on the total count, current page, and limit.
 *
 * @template T - The type of documents in the response
 * @param docs - Array of documents for the current page
 * @param options - Pagination options including total count, page, and limit
 * @returns Complete paginated response with all metadata fields
 *
 * @example
 * ```typescript
 * const entries = await db.select().from(posts).limit(10).offset(0);
 * const total = await db.select({ count: sql`count(*)` }).from(posts);
 *
 * const response = buildPaginatedResponse(entries, {
 *   total: Number(total[0].count),
 *   page: 1,
 *   limit: 10,
 * });
 * // Returns: { docs, totalDocs, limit, totalPages, page, pagingCounter, ... }
 * ```
 */
export function buildPaginatedResponse<T>(
  docs: T[],
  options: BuildPaginatedResponseOptions
): PaginatedResponse<T> {
  const { total, page, limit } = options;

  // Calculate total pages (minimum 1 to avoid division issues)
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Ensure page is within valid bounds
  const currentPage = Math.max(1, Math.min(page, totalPages));

  // Calculate pagingCounter (1-indexed position of first doc on current page)
  // For page 1 with limit 10, pagingCounter = 1
  // For page 2 with limit 10, pagingCounter = 11
  const pagingCounter = (currentPage - 1) * limit + 1;

  return {
    docs,
    totalDocs: total,
    limit,
    totalPages,
    page: currentPage,
    pagingCounter,
    hasPrevPage: currentPage > 1,
    hasNextPage: currentPage < totalPages,
    prevPage: currentPage > 1 ? currentPage - 1 : null,
    nextPage: currentPage < totalPages ? currentPage + 1 : null,
  };
}

/**
 * Clamps a limit value to be within valid bounds.
 *
 * @param limit - The requested limit value
 * @param maxLimit - Maximum allowed limit (default: 500)
 * @returns Clamped limit value between 1 and maxLimit
 */
export function clampLimit(
  limit: number,
  maxLimit: number = PAGINATION_DEFAULTS.maxLimit
): number {
  return Math.max(1, Math.min(limit, maxLimit));
}

/**
 * Calculates the SQL OFFSET value for pagination.
 *
 * @param page - Current page number (1-indexed)
 * @param limit - Number of documents per page
 * @returns Offset value for SQL query
 */
export function calculateOffset(page: number, limit: number): number {
  return (Math.max(1, page) - 1) * limit;
}
