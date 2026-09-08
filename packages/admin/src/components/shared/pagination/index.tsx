"use client";

import * as React from "react";

import {
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
} from "@admin/components/icons";
import { PAGINATION } from "@admin/constants/pagination";
import { cn } from "@admin/lib/utils";

import type { PaginationProps } from "./types";

/**
 * What the control says about the rows, which is the part a reader takes at
 * face value.
 *
 * Its own component because the question it answers has three outcomes and the
 * control around it has none: an unknown total, an empty list, and a range.
 * Inline, that is three nested conditionals inside a body that is already long.
 *
 * ADDRESSABLE, via `data-slot`. The landmark also contains the page-size
 * selector, whose label carries the word "page", so a query made against the
 * landmark as a whole cannot tell this line's text from the selector's — it
 * has to be reachable on its own.
 */
function PaginationSummary({
  currentPage,
  itemLabel,
  pageSize,
  totalItems,
  totalPages,
}: {
  currentPage: number;
  itemLabel: string;
  pageSize: number;
  totalItems: number | undefined;
  totalPages: number;
}): React.JSX.Element {
  /*
   * An absent total is not an empty one: a caller that cannot count says
   * nothing about how many rows exist, and gets the page-of-pages form.
   */
  if (totalItems === undefined) {
    return (
      <div
        className="whitespace-nowrap order-2 @2xl/content:order-1"
        data-slot="pagination-summary"
      >
        Page <span className="font-semibold">{currentPage + 1}</span> of{" "}
        <span className="font-semibold">{totalPages}</span>
      </div>
    );
  }

  /*
   * A RANGE only exists when there are rows to bound. Its start is
   * `currentPage * pageSize + 1`, which is 1 on the first page whatever the
   * total, while its end is clamped to the total — so an empty list read
   * "Showing 1-0 of 0", a range whose start is past its end, describing a
   * first row that is not there.
   *
   * Said as a count rather than a range, because that is what an empty list
   * has. "Showing 0-0" would be arithmetically tidy and still answer a
   * question nobody asked.
   */
  return (
    <div
      className="whitespace-nowrap order-2 @2xl/content:order-1"
      data-slot="pagination-summary"
    >
      {totalItems === 0 ? (
        <>No {itemLabel}</>
      ) : (
        <>
          Showing {currentPage * pageSize + 1}-
          {Math.min((currentPage + 1) * pageSize, totalItems)} of {totalItems}{" "}
          {itemLabel}
        </>
      )}
    </div>
  );
}

/**
 * Pagination Component
 *
 * A reusable pagination component with page controls, page size selector, and smart page numbering.
 * Designed for data tables and lists with server-side or client-side pagination.
 *
 * ## Design Specifications
 * - **Button Size**: 32px (h-8 w-8) - sufficient touch target
 * - **Button Variant**: secondary (default), primary (current page)
 * - **Border Radius**: `rounded-md` on the standalone nav buttons; the numbered
 *   buttons stay square because they overlap borders into a single strip
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
 * ### Basic usage
 *
 * A table hands its pagination to `DataTableView` as data and never renders
 * this component itself — the table knows which of its two views is showing,
 * so it is the only thing that can place a pager correctly:
 *
 * ```tsx
 * function UserList() {
 *   const { page, pageSize, setPage, setPageSize } = usePagination();
 *   const { data } = useUsers({ pagination: { page, pageSize } });
 *
 *   return (
 *     <DataTableView
 *       columns={columns}
 *       rows={data.items}
 *       pagination={{
 *         currentPage: page,
 *         totalPages: data.meta.totalPages,
 *         pageSize,
 *         onPageChange: setPage,
 *         onPageSizeChange: setPageSize,
 *       }}
 *     />
 *   );
 * }
 * ```
 *
 * `usePagination` owns the first-page resets, so `onPageSizeChange` is its
 * `setPageSize` rather than a wrapper that also calls `setPage(0)`. Rendering
 * this component directly is for lists that are NOT tables — a grid, or rows
 * drawn by something other than `DataTableView`.
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
export const Pagination = React.forwardRef<HTMLElement, PaginationProps>(
  (
    {
      currentPage,
      totalPages,
      pageSize,
      pageSizeOptions = PAGINATION.TABLE_PAGE_SIZE_OPTIONS,
      showPageSizeSelector = true,
      maxVisiblePages = 5,
      onPageChange,
      onPageSizeChange,
      isLoading = false,
      totalItems,
      itemLabel = "items",
      ariaLabel = "Pagination",
      className,
    },
    ref
  ) => {
    const canGoPrevious = currentPage > 0;
    const canGoNext = currentPage < totalPages - 1;

    /** Arrow/Home/End move between pages while the control has focus. */
    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent) => {
        if (isLoading) return;

        // These keys already mean something inside a form control — a select
        // jumps between its options with them — and keydown reaches this nav
        // by bubbling from its own children. Taking the key there would both
        // block the control and move the page out from under whoever is using
        // it.
        if (
          (e.target as HTMLElement | null)?.closest(
            "select, input, textarea, [contenteditable='true']"
          )
        ) {
          return;
        }

        switch (e.key) {
          case "ArrowLeft":
            if (canGoPrevious) {
              e.preventDefault();
              onPageChange(currentPage - 1);
            }
            break;
          case "ArrowRight":
            if (canGoNext) {
              e.preventDefault();
              onPageChange(currentPage + 1);
            }
            break;
          case "Home":
            if (canGoPrevious) {
              e.preventDefault();
              onPageChange(0);
            }
            break;
          case "End":
            if (canGoNext) {
              e.preventDefault();
              onPageChange(totalPages - 1);
            }
            break;
        }
      },
      [
        isLoading,
        canGoPrevious,
        canGoNext,
        currentPage,
        totalPages,
        onPageChange,
      ]
    );
    // Render smart page numbers with ellipsis
    const renderPageNumbers = () => {
      // Common button class
      const getButtonClass = (isActive: boolean) =>
        cn(
          // Square corners: page buttons overlap their borders (-ml-px) into
          // one continuous strip, which a radius would break apart.
          "flex h-10 w-10 items-center justify-center rounded-none text-xs z-10 -ml-px transition-colors focus:outline-none focus:border-primary cursor-pointer",
          isActive
            ? "bg-primary! text-primary-foreground border-primary! z-20"
            : "bg-background  border border-border-strong hover-unified disabled:opacity-50 disabled:cursor-not-allowed"
        );

      // Helper for ellipsis
      const renderEllipsis = (key: string) => (
        <span
          key={key}
          // Square corners: the ellipsis sits inside the same
          // overlapped-border strip as the page buttons.
          className="flex h-10 w-10 items-center justify-center rounded-none  border border-border-strong bg-background text-muted-foreground text-xs -ml-px"
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
      <nav
        ref={ref}
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex flex-col @2xl/content:flex-row w-full items-center justify-between gap-4 text-xs @md/content:text-sm text-muted-foreground p-4 border-t border-border bg-[var(--nx-table-header-bg)]",
          className
        )}
      >
        {/* Left: Info */}
        <PaginationSummary
          currentPage={currentPage}
          itemLabel={itemLabel}
          pageSize={pageSize}
          totalItems={totalItems}
          totalPages={totalPages}
        />

        {/* Right: Controls */}
        <div className="flex flex-wrap items-center justify-center gap-4 @md/content:gap-6 @4xl/content:gap-8 order-1 @2xl/content:order-2">
          {/* Page size selector */}
          {showPageSizeSelector && onPageSizeChange && (
            <div className="flex items-center space-x-2">
              <span className="whitespace-nowrap hidden @md/content:inline-block">
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
                  className="h-9 w-[70px] appearance-none rounded-md  border border-input bg-background px-2 py-1 text-sm font-medium focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed hover-unified cursor-pointer"
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
              className="hidden @md/content:flex h-10 w-10 items-center justify-center rounded-md  border border-border-strong bg-background hover-unified disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-primary z-10 cursor-pointer"
              aria-label="Go to first page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>

            {/* Previous */}
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 0 || isLoading}
              className="flex h-10 w-10 items-center justify-center rounded-md  border border-border-strong bg-background hover-unified disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-primary z-10 cursor-pointer"
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
              className="flex h-10 w-10 items-center justify-center rounded-md  border border-border-strong bg-background hover-unified disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-primary z-10 cursor-pointer"
              aria-label="Go to next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            {/* Last */}
            <button
              onClick={() => onPageChange(totalPages - 1)}
              disabled={currentPage >= totalPages - 1 || isLoading}
              className="hidden @md/content:flex h-10 w-10 items-center justify-center rounded-md  border border-border-strong bg-background hover-unified disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-primary z-10 cursor-pointer"
              aria-label="Go to last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>

          {/* Page Count (Far Right) */}
          <div className="whitespace-nowrap hidden @md/content:block">
            Page {currentPage + 1} of {totalPages}
          </div>
        </div>
      </nav>
    );
  }
);

Pagination.displayName = "Pagination";
