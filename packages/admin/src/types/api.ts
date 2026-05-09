/**
 * API Response Types
 *
 * Common types for API responses used across the admin package.
 *
 * @module types/api
 */

/**
 * Pagination metadata returned from API endpoints
 */
export interface PaginationMeta {
  /** Current page number (0-indexed) */
  page: number;
  /** Number of items per page */
  pageSize: number;
  /** Total number of items across all pages */
  totalCount: number;
  /** Total number of pages */
  totalPages: number;
}

/**
 * Generic paginated response wrapper for API endpoints
 *
 * @template T - The type of items in the data array
 *
 * @example
 * ```typescript
 * import type { PaginatedResponse } from '@admin/types/api';
 * import type { UserApiResponse } from '@admin/types/entities';
 *
 * const response: PaginatedResponse<UserApiResponse> = {
 *   data: [{ id: '1', name: 'John', ... }],
 *   meta: {
 *     page: 0,
 *     pageSize: 10,
 *     totalCount: 100,
 *     totalPages: 10,
 *   },
 * };
 * ```
 */
export interface PaginatedResponse<T> {
  /** Array of items for the current page */
  data: T[];
  /** Pagination metadata */
  meta: PaginationMeta;
}

/**
 * Generic API error response
 */
export interface ApiErrorResponse {
  /** Error message */
  message: string;
  /** HTTP status code */
  statusCode?: number;
  /** Error code for programmatic handling */
  code?: string;
  /** Additional error details */
  details?: Record<string, unknown>;
}

/**
 * Generic API success response wrapper
 *
 * @template T - The type of the data payload
 */
export interface ApiResponse<T> {
  /** Response data */
  data: T;
  /** Optional success message */
  message?: string;
}
