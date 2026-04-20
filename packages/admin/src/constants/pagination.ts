/**
 * Pagination Constants
 *
 * Centralized pagination configuration for consistent behavior across the application.
 */

export const PAGINATION = {
  /**
   * Maximum page size for fetching all records.
   * Used when we need to load complete datasets (e.g., all permissions, all roles).
   */
  MAX_PAGE_SIZE: 1000,

  /**
   * Default page size for paginated lists.
   */
  DEFAULT_PAGE_SIZE: 20,

  /**
   * Default page size for table views (10 items per page).
   */
  TABLE_DEFAULT_PAGE_SIZE: 10,

  /**
   * Default starting page (0-indexed).
   */
  DEFAULT_PAGE: 0,
} as const;
