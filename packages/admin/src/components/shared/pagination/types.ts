/**
 * Props for Pagination component
 */
export type PaginationProps = {
  /** Current page index (0-based) */
  currentPage: number;
  /** Total number of pages */
  totalPages: number;
  /** Current page size (items per page) */
  pageSize: number;
  /** Available page size options for the selector */
  pageSizeOptions?: number[];
  /** Whether to show the page size selector */
  showPageSizeSelector?: boolean;
  /** Maximum number of visible page number buttons */
  maxVisiblePages?: number;
  /** Callback when page changes */
  onPageChange: (page: number) => void;
  /** Optional callback when page size changes */
  onPageSizeChange?: (pageSize: number) => void;
  /** Loading state (disables all controls) */
  isLoading?: boolean;
  /** Total number of items across all pages */
  totalItems?: number;
  /** Optional custom className for the container */
  className?: string;
};
