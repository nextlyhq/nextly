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

  /**
   * Page sizes a table's size selector offers.
   *
   * One array rather than a literal per list. The same three values were
   * written out at nine call sites, which is nine chances for a list to offer a
   * different set than its neighbours for no stated reason -- and no way to
   * change the policy without finding all nine.
   *
   * A list whose rows are unusually large or small states its own instead of
   * bending this one: the media grid offers 12/24/48/96 because it lays out
   * thumbnails, and the delivery log offers 20/50/100 because it is read in
   * long scans. Those are decisions about that surface, not about tables.
   */
  TABLE_PAGE_SIZE_OPTIONS: [10, 25, 50],
} as const;
