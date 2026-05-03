"use client";

import * as React from "react";

import {
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
} from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import type { PaginationProps } from "./types";

/**
 * Pagination Component
 *
 * A reusable pagination component with page controls, page size selector, and smart page numbering.
 * Designed for data tables and lists with server-side or client-side pagination.
 *
 * ## Design Specifications
 * - **Button Size**: 32px (h-8 w-8) - sufficient touch target
 * - **Button Variant**: secondary (default), primary (current page)
 * - **Border Radius**: 6px (rounded-none) - matches design system
 * - **Spacing**: 8px gap (gap-2) between controls
 * - **Typography**: text-sm for page info and page size selector
 * - **Max Visible Pages**: Configurable (default: 5)
 *
 * ## Features
 * - **Smart page numbers**: Shows ellipsis (...) for many pages
 * - **Page size selector**: Dropdown to change items per page
 * - **First/Last buttons**: Quick navigation to start/end
 * - **Prev/Next buttons**: Navigate adjacent pages
 * - **Page info**: Displays "Page X of Y"
 * - **Disabled states**: Buttons disabled at boundaries or when loading
 * - **Responsive**: Horizontal scroll on mobile, wraps controls
 *
 * ## Accessibility
 * - All buttons have proper `disabled` attribute
 * - Page numbers are properly labeled
 * - Keyboard navigation supported (Tab, Enter, Space)
 * - ARIA attributes for screen readers
 *
 * ## Usage Examples
 *
 * ### Basic Usage
 * ```tsx
 * import { Pagination } from "@nextly/admin";
 *
 * function UserList() {
 *   const [page, setPage] = useState(0);
 *   const [pageSize, setPageSize] = useState(10);
 *   const { data } = useUsers({ pagination: { page, pageSize } });
 *
 *   return (
 *     <Pagination
 *       currentPage={page}
 *       totalPages={data.meta.totalPages}
 *       pageSize={pageSize}
 *       onPageChange={setPage}
 *       onPageSizeChange={(size) => {
 *         setPageSize(size);
 *         setPage(0); // Reset to first page
 *       }}
 *     />
 *   );
 * }
 * ```
 *
 * ### With Custom Page Size Options
 * ```tsx
 * <Pagination
 *   currentPage={page}
 *   totalPages={10}
 *   pageSize={pageSize}
 *   pageSizeOptions={[5, 10, 20, 50, 100]}
 *   onPageChange={setPage}
 *   onPageSizeChange={setPageSize}
 * />
 * ```
 *
 * ### With More Visible Pages
 * ```tsx
 * <Pagination
 *   currentPage={page}
 *   totalPages={100}
 *   pageSize={pageSize}
 *   maxVisiblePages={7} // Show more page numbers
 *   onPageChange={setPage}
 *   onPageSizeChange={setPageSize}
 * />
 * ```
 *
 * ### Without Page Size Selector
 * ```tsx
 * <Pagination
 *   currentPage={page}
 *   totalPages={10}
 *   pageSize={10}
 *   showPageSizeSelector={false}
 *   onPageChange={setPage}
 * />
 * ```
 *
 * @example
 * ```tsx
 * <Pagination
 *   currentPage={currentPage}
 *   totalPages={meta.totalPages}
 *   pageSize={pageSize}
 *   pageSizeOptions={[10, 25, 50]}
 *   onPageChange={handlePageChange}
 *   onPageSizeChange={handlePageSizeChange}
 *   isLoading={isLoading}
 * />
 * ```
 */
export const Pagination = React.forwardRef<HTMLDivElement, PaginationProps>(
  (
    {
      currentPage,
      totalPages,
      pageSize,
      pageSizeOptions = [10, 25, 50],
      showPageSizeSelector = true,
      maxVisiblePages = 5,
      onPageChange,
      onPageSizeChange,
      isLoading = false,
      totalItems,
      className,
    },
    ref
  ) => {
    // Render smart page numbers with ellipsis
    const renderPageNumbers = () => {
      // Common button class
      const getButtonClass = (isActive: boolean) =>
        cn(
          "flex h-10 w-10 items-center justify-center rounded-none text-xs z-10 -ml-px transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer",
          isActive
            ? "!bg-primary text-primary-foreground !border-primary z-20"
            : "bg-background  border border-primary/5 hover-unified disabled:opacity-50 disabled:cursor-not-allowed"
        );

      // Helper for ellipsis
      const renderEllipsis = (key: string) => (
        <span
          key={key}
          className="flex h-10 w-10 items-center justify-center rounded-none  border border-primary/5 bg-background text-muted-foreground text-xs -ml-px"
          aria-hidden="true"
        >
          ...
        </span>
      );

      if (totalPages <= maxVisiblePages) {
        // Show all pages
        return Array.from({ length: totalPages }).map((_, i) => (
          <button
            key={`page-${i}`}
            onClick={() => onPageChange(i)}
            disabled={isLoading}
            className={getButtonClass(currentPage === i)}
            aria-label={`Go to page ${i + 1}`}
            aria-current={currentPage === i ? "page" : undefined}
          >
            {i + 1}
          </button>
        ));
      }

      // Smart pagination with ellipsis
      const pages: React.ReactNode[] = [];
      let startPage = Math.max(
        0,
        currentPage - Math.floor(maxVisiblePages / 2)
      );
      const endPage = Math.min(totalPages - 1, startPage + maxVisiblePages - 1);

      // Adjust startPage if we're near the end
      if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(0, endPage - maxVisiblePages + 1);
      }

      // First page + ellipsis
      if (startPage > 0) {
        pages.push(
          <button
            key="page-0"
            onClick={() => onPageChange(0)}
            disabled={isLoading}
            className={getButtonClass(currentPage === 0)}
            aria-label="Go to first page"
          >
            1
          </button>
        );
        if (startPage > 1) {
          pages.push(renderEllipsis("ellipsis-start"));
        }
      }

      // Visible pages
      for (let i = startPage; i <= endPage; i++) {
        pages.push(
          <button
            key={i}
            onClick={() => onPageChange(i)}
            disabled={isLoading}
            className={getButtonClass(currentPage === i)}
            aria-label={`Go to page ${i + 1}`}
            aria-current={currentPage === i ? "page" : undefined}
          >
            {i + 1}
          </button>
        );
      }

      // Ellipsis + last page
      if (endPage < totalPages - 1) {
        if (endPage < totalPages - 2) {
          pages.push(renderEllipsis("ellipsis-end"));
        }
        pages.push(
          <button
            key={totalPages - 1}
            onClick={() => onPageChange(totalPages - 1)}
            disabled={isLoading}
            className={getButtonClass(currentPage === totalPages - 1)}
            aria-label="Go to last page"
          >
            {totalPages}
          </button>
        );
      }

      return pages;
    };

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col sm:flex-row w-full items-center justify-between gap-4 text-xs sm:text-sm text-muted-foreground p-4 border-t border-primary/5 bg-[hsl(var(--table-header-bg))]",
          className
        )}
      >
        {/* Left: Info */}
        <div className="whitespace-nowrap order-2 sm:order-1">
          {totalItems !== undefined ? (
            <>
              Showing {currentPage * pageSize + 1}-
              {Math.min((currentPage + 1) * pageSize, totalItems)} of{" "}
              {totalItems} entries
            </>
          ) : (
            <>
              Page <span className="font-semibold">{currentPage + 1}</span> of{" "}
              <span className="font-semibold">{totalPages}</span>
            </>
          )}
        </div>

        {/* Right: Controls */}
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 lg:gap-8 order-1 sm:order-2">
          {/* Page size selector */}
          {showPageSizeSelector && onPageSizeChange && (
            <div className="flex items-center space-x-2">
              <span className="whitespace-nowrap hidden sm:inline-block">
                Rows per page
              </span>
              <div className="relative">
                <select
                  id="page-size"
                  value={pageSize}
                  onChange={e => {
                    const newPageSize = Number(e.target.value);
                    onPageSizeChange(newPageSize);
                  }}
                  disabled={isLoading}
                  className="h-9 w-[70px] appearance-none rounded-none  border border-primary/5 bg-background px-2 py-1 text-sm font-medium focus-visible:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed hover-unified cursor-pointer"
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
          <div className="flex items-center gap-1">
            {/* First */}
            <button
              onClick={() => onPageChange(0)}
              disabled={currentPage === 0 || isLoading}
              className="hidden sm:flex h-10 w-10 items-center justify-center rounded-none  border border-primary/5 bg-background hover-unified disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring z-10 cursor-pointer"
              aria-label="Go to first page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>

            {/* Previous */}
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 0 || isLoading}
              className="flex h-10 w-10 items-center justify-center rounded-none  border border-primary/5 bg-background hover-unified disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring z-10"
              aria-label="Go to previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            {/* Numbers */}
            <div className="flex">{renderPageNumbers()}</div>

            {/* Next */}
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages - 1 || isLoading}
              className="flex h-10 w-10 items-center justify-center rounded-none  border border-primary/5 bg-background hover-unified disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring z-10"
              aria-label="Go to next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            {/* Last */}
            <button
              onClick={() => onPageChange(totalPages - 1)}
              disabled={currentPage >= totalPages - 1 || isLoading}
              className="hidden sm:flex h-10 w-10 items-center justify-center rounded-none  border border-primary/5 bg-background hover-unified disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring z-10 cursor-pointer"
              aria-label="Go to last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>

          {/* Page Count (Far Right) */}
          <div className="whitespace-nowrap hidden sm:block">
            Page {currentPage + 1} of {totalPages}
          </div>
        </div>
      </div>
    );
  }
);

Pagination.displayName = "Pagination";
