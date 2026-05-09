import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import type { PaginationMeta, PaginationConfig } from "../types/table";

/**
 * Props for TablePagination component
 */
export interface TablePaginationProps {
  /** Pagination metadata from server */
  meta: PaginationMeta;
  /** Callback when page changes */
  onPageChange: (page: number) => void;
  /** Callback when page size changes */
  onPageSizeChange: (pageSize: number) => void;
  /** Pagination configuration */
  config?: Required<PaginationConfig>;
  /** Whether data is currently loading */
  isLoading?: boolean;
}

/**
 * Renders smart pagination with ellipsis for large page counts
 */
function renderPageNumbers(
  currentPage: number,
  totalPages: number,
  maxVisiblePages: number,
  onPageChange: (page: number) => void
) {
  // Common button class
  const getBtnClass = (active: boolean) =>
    `flex h-8 w-8 items-center justify-center  border-y border-primary/5  border-r border-primary/5 text-xs z-10 -ml-px transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
      active
        ? "!bg-primary !text-primary-foreground !border-primary z-20"
        : "!bg-background !border-primary/5 hover-muted disabled:opacity-50"
    }`;

  // Case 1: Few pages - show all without ellipsis
  if (totalPages <= maxVisiblePages) {
    return Array.from({ length: totalPages }).map((_, i) => (
      <button
        key={`page-${i}`}
        onClick={() => onPageChange(i)}
        aria-label={`Go to page ${i + 1}`}
        aria-current={currentPage === i ? "page" : undefined}
        className={getBtnClass(currentPage === i)}
      >
        {i + 1}
      </button>
    ));
  }

  // Case 2: Many pages - show window with ellipsis
  const pages = [];

  // Calculate the window of pages to show around current page
  const startPage = Math.max(0, currentPage - Math.floor(maxVisiblePages / 2));
  const endPage = Math.min(totalPages - 1, startPage + maxVisiblePages - 1);

  // Always show first page if not in window
  if (startPage > 0) {
    pages.push(
      <button
        key="page-0"
        onClick={() => onPageChange(0)}
        aria-label="Go to page 1"
        className={getBtnClass(currentPage === 0)}
      >
        1
      </button>
    );
    // Show ellipsis if there's a gap between first page and window
    if (startPage > 1) {
      pages.push(
        <span
          key="ellipsis-start"
          className="flex h-8 w-8 items-center justify-center  border-y border-primary/5  border-r border-primary/5 !border-primary/5 !bg-background text-muted-foreground text-xs -ml-px"
          aria-hidden="true"
        >
          ...
        </span>
      );
    }
  }

  // Show the window of pages
  for (let i = startPage; i <= endPage; i++) {
    pages.push(
      <button
        key={i}
        onClick={() => onPageChange(i)}
        aria-label={`Go to page ${i + 1}`}
        aria-current={currentPage === i ? "page" : undefined}
        className={getBtnClass(currentPage === i)}
      >
        {i + 1}
      </button>
    );
  }

  // Always show last page if not in window
  if (endPage < totalPages - 1) {
    // Show ellipsis if there's a gap between window and last page
    if (endPage < totalPages - 2) {
      pages.push(
        <span
          key="ellipsis-end"
          className="flex h-8 w-8 items-center justify-center  border-y border-primary/5  border-r border-primary/5 !border-primary/5 !bg-background text-muted-foreground text-xs -ml-px"
          aria-hidden="true"
        >
          ...
        </span>
      );
    }
    pages.push(
      <button
        key={totalPages - 1}
        onClick={() => onPageChange(totalPages - 1)}
        aria-label={`Go to page ${totalPages}`}
        className={getBtnClass(currentPage === totalPages - 1)}
      >
        {totalPages}
      </button>
    );
  }

  return pages;
}

/**
 * Pagination controls for tables
 */
export function TablePagination({
  meta,
  onPageChange,
  onPageSizeChange,
  config,
  isLoading = false,
}: TablePaginationProps) {
  const {
    showPageSizeSelector = true,
    pageSizeOptions = [10, 20, 30, 50],
    maxVisiblePages = 5,
  } = config || {};

  return (
    <div className="flex flex-col sm:flex-row w-full items-center justify-between gap-4 text-xs sm:text-sm text-muted-foreground p-4 border-t border-primary/5">
      {/* Left: Info. `meta.page` is 1-based per spec §5.1; the
          0-based UI page index lives in this component's local state via
          the React Table `pageIndex` prop. We render the displayed range
          using `meta.limit` (canonical wire field). */}
      <div className="whitespace-nowrap order-2 sm:order-1">
        Showing {(meta.page - 1) * meta.limit + 1}-
        {Math.min(meta.page * meta.limit, meta.total)} of {meta.total} entries
      </div>

      {/* Right: Controls */}
      <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 lg:gap-8 order-1 sm:order-2">
        {/* Page size selector */}
        {showPageSizeSelector && (
          <div className="flex items-center space-x-2">
            <span className="whitespace-nowrap hidden sm:inline-block">
              Rows per page
            </span>
            <div className="relative">
              <select
                id="pageSize"
                value={meta.limit}
                onChange={e => {
                  const newPageSize = Number(e.target.value);
                  onPageSizeChange(newPageSize);
                }}
                className="h-8 w-[70px] appearance-none rounded-none  border border-primary/5 bg-background px-2 py-1 text-sm font-medium focus-visible:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 hover-muted cursor-pointer"
                disabled={isLoading}
              >
                {pageSizeOptions.map(size => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Buttons Group */}
        <div className="flex items-center -space-x-px">
          {/* First */}
          <button
            onClick={() => onPageChange(0)}
            disabled={meta.page === 0 || isLoading}
            className="hidden sm:flex h-8 w-8 items-center justify-center rounded-none  border border-primary/5 bg-background hover-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring z-10"
            aria-label="First page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>

          {/* Previous */}
          <button
            onClick={() => onPageChange(meta.page - 1)}
            disabled={meta.page === 0 || isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-none sm:rounded-none  border border-primary/5 bg-background hover-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring z-10"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Numbers */}
          <div className="flex">
            {renderPageNumbers(
              meta.page,
              meta.totalPages,
              maxVisiblePages,
              onPageChange
            )}
          </div>

          {/* Next */}
          <button
            onClick={() => onPageChange(meta.page + 1)}
            disabled={meta.page >= meta.totalPages - 1 || isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-none sm:rounded-none  border-y border-primary/5  border-x border-primary/5 sm :border-r border-primary/5 bg-background hover-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring z-10"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          {/* Last */}
          <button
            onClick={() => onPageChange(meta.totalPages - 1)}
            disabled={meta.page >= meta.totalPages - 1 || isLoading}
            className="hidden sm:flex h-8 w-8 items-center justify-center rounded-none  border border-primary/5 bg-background hover-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring z-10"
            aria-label="Last page"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>

        {/* Page Count (Far Right) */}
        <div className="whitespace-nowrap hidden sm:block">
          Page {meta.page + 1} of {meta.totalPages}
        </div>
      </div>
    </div>
  );
}
