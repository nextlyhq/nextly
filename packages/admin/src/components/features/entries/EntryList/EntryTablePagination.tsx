"use client";

/**
 * Entry Table Pagination Component
 *
 * Enhanced pagination controls for the entry table with:
 * - Smart page number buttons with ellipsis
 * - Page size selector
 * - First/Previous/Next/Last navigation
 * - Jump to page input (click on "Page X of Y" to edit)
 * - Keyboard navigation support
 *
 * @module components/entries/EntryList/EntryTablePagination
 * @since 1.0.0
 */

import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import type { EntryTablePagination as PaginationType } from "./EntryTable";

// ============================================================================
// Constants
// ============================================================================

/**
 * Available page size options.
 */
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * Maximum number of visible page buttons before showing ellipsis.
 */
const MAX_VISIBLE_PAGES = 5;

/**
 * Threshold for showing ellipsis (gap must be > this value).
 */
const ELLIPSIS_THRESHOLD = 1;

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the EntryTablePagination component.
 */
export interface EntryTablePaginationProps {
  /** Pagination state */
  pagination: PaginationType;
  /** Callback when page changes (0-indexed) */
  onPageChange: (page: number) => void;
  /** Callback when page size changes */
  onLimitChange: (limit: number) => void;
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Optional className for the container */
  className?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate array of page numbers to display with ellipsis placeholders.
 *
 * Algorithm:
 * 1. If total pages <= maxVisiblePages: Show all pages (no ellipsis)
 * 2. Otherwise: Show a window of pages around current page with ellipsis
 *    - Always show first page (1)
 *    - Show ellipsis (...) if gap > ELLIPSIS_THRESHOLD
 *    - Show current page window (centered around current page)
 *    - Show ellipsis (...) if gap > ELLIPSIS_THRESHOLD
 *    - Always show last page (totalPages)
 *
 * @param currentPage - Current page (0-indexed)
 * @param totalPages - Total number of pages
 * @returns Array of page numbers or 'ellipsis' placeholders
 */
function getPageRange(
  currentPage: number,
  totalPages: number
): (number | "ellipsis-start" | "ellipsis-end")[] {
  // Case 1: Few pages - show all without ellipsis
  if (totalPages <= MAX_VISIBLE_PAGES) {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  // Case 2: Many pages - show window with ellipsis
  const pages: (number | "ellipsis-start" | "ellipsis-end")[] = [];

  // Calculate the window of pages to show around current page
  let startPage = Math.max(0, currentPage - Math.floor(MAX_VISIBLE_PAGES / 2));
  const endPage = Math.min(totalPages - 1, startPage + MAX_VISIBLE_PAGES - 1);

  // Adjust startPage if we're near the end to always show full window
  if (endPage - startPage < MAX_VISIBLE_PAGES - 1) {
    startPage = Math.max(0, endPage - MAX_VISIBLE_PAGES + 1);
  }

  // First page + ellipsis
  if (startPage > 0) {
    pages.push(0); // First page
    if (startPage > ELLIPSIS_THRESHOLD) {
      pages.push("ellipsis-start");
    }
  }

  // Visible pages window
  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  // Ellipsis + last page
  if (endPage < totalPages - 1) {
    if (endPage < totalPages - 1 - ELLIPSIS_THRESHOLD) {
      pages.push("ellipsis-end");
    }
    pages.push(totalPages - 1);
  }

  return pages;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Enhanced pagination controls for entry table.
 *
 * Features:
 * - Smart page number buttons with ellipsis for large page counts
 * - Page size selector (10, 25, 50, 100)
 * - First/Previous/Next/Last navigation buttons
 * - Jump to page input (click on "Page X of Y" to edit)
 * - Keyboard navigation (Left/Right arrows when focused)
 * - Loading state support
 * - ARIA accessibility labels
 *
 * @param props - Pagination props
 * @returns Pagination component
 *
 * @example
 * ```tsx
 * <EntryTablePagination
 *   pagination={{ page: 0, limit: 10, total: 100, totalPages: 10 }}
 *   onPageChange={(page) => setPage(page)}
 *   onLimitChange={(limit) => setLimit(limit)}
 *   isLoading={isLoading}
 * />
 * ```
 */
export function EntryTablePagination({
  pagination,
  onPageChange,
  onLimitChange,
  isLoading = false,
  className,
}: EntryTablePaginationProps) {
  const { page, limit, total, totalPages } = pagination;

  // ---------------------------------------------------------------------------
  // Jump to Page State
  // ---------------------------------------------------------------------------

  const [isEditingPage, setIsEditingPage] = useState(false);
  const [jumpToPageValue, setJumpToPageValue] = useState("");
  const jumpToPageInputRef = useRef<HTMLInputElement>(null);

  // Calculate display values (convert 0-indexed to 1-indexed for display)
  const displayPage = page + 1;
  const start = total === 0 ? 0 : page * limit + 1;
  const end = Math.min((page + 1) * limit, total);

  // Navigation state
  const canGoPrevious = page > 0;
  const canGoNext = page < totalPages - 1;

  // Get page range for rendering
  const pageRange = getPageRange(page, totalPages);

  // ---------------------------------------------------------------------------
  // Jump to Page Handlers
  // ---------------------------------------------------------------------------

  const handlePageInfoClick = useCallback(() => {
    if (isLoading || totalPages <= 1) return;
    setIsEditingPage(true);
    setJumpToPageValue(String(displayPage));
  }, [isLoading, totalPages, displayPage]);

  const handleJumpToPageSubmit = useCallback(() => {
    const targetPage = parseInt(jumpToPageValue, 10);
    if (!isNaN(targetPage) && targetPage >= 1 && targetPage <= totalPages) {
      onPageChange(targetPage - 1); // Convert to 0-indexed
    }
    setIsEditingPage(false);
    setJumpToPageValue("");
  }, [jumpToPageValue, totalPages, onPageChange]);

  const handleJumpToPageKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleJumpToPageSubmit();
      } else if (e.key === "Escape") {
        setIsEditingPage(false);
        setJumpToPageValue("");
      }
    },
    [handleJumpToPageSubmit]
  );

  const handleJumpToPageBlur = useCallback(() => {
    handleJumpToPageSubmit();
  }, [handleJumpToPageSubmit]);

  // Focus input when editing mode is activated
  useEffect(() => {
    if (isEditingPage && jumpToPageInputRef.current) {
      jumpToPageInputRef.current.focus();
      jumpToPageInputRef.current.select();
    }
  }, [isEditingPage]);

  // ---------------------------------------------------------------------------
  // Keyboard Navigation Handler
  // ---------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isLoading) return;

      switch (e.key) {
        case "ArrowLeft":
          if (canGoPrevious) {
            e.preventDefault();
            onPageChange(page - 1);
          }
          break;
        case "ArrowRight":
          if (canGoNext) {
            e.preventDefault();
            onPageChange(page + 1);
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
    [isLoading, canGoPrevious, canGoNext, page, totalPages, onPageChange]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <nav
      aria-label="Entry table pagination"
      className={cn(
        "flex flex-col md:flex-row items-center justify-between gap-4 p-4 border-t border-primary/5 bg-[hsl(var(--table-header-bg))]",
        className
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Entry count info */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground order-2 md:order-1">
        <span>
          {total === 0 ? (
            "No entries"
          ) : (
            <>
              Showing <span className="font-medium">{start}</span>-
              <span className="font-medium">{end}</span> of{" "}
              <span className="font-medium">{total}</span> entries
            </>
          )}
        </span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 order-1 md:order-2">
        {/* Page size selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground hidden sm:inline-block">
            Rows per page
          </span>
          <Select
            value={String(limit)}
            onValueChange={value => onLimitChange(Number(value))}
            disabled={isLoading}
          >
            <SelectTrigger className="h-8 w-[70px] hover-unified">
              <SelectValue placeholder={limit} />
            </SelectTrigger>
            <SelectContent side="top">
              {PAGE_SIZE_OPTIONS.map(pageSize => (
                <SelectItem key={pageSize} value={String(pageSize)}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Page navigation */}
        <div className="flex items-center gap-1">
          {/* First page */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 hidden sm:flex"
            onClick={() => onPageChange(0)}
            disabled={!canGoPrevious || isLoading}
            aria-label="Go to first page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>

          {/* Previous page */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(page - 1)}
            disabled={!canGoPrevious || isLoading}
            aria-label="Go to previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {/* Page number buttons */}
          <div className="flex items-center gap-1 mx-1">
            {pageRange.map(item => {
              if (item === "ellipsis-start" || item === "ellipsis-end") {
                return (
                  <span
                    key={item}
                    className="px-2 text-sm text-muted-foreground select-none"
                    aria-hidden="true"
                  >
                    ...
                  </span>
                );
              }

              const pageNum = item;
              const isCurrentPage = pageNum === page;

              return (
                <Button
                  key={`page-${pageNum}`}
                  variant={isCurrentPage ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onPageChange(pageNum)}
                  disabled={isLoading}
                  aria-label={`Go to page ${pageNum + 1}`}
                  aria-current={isCurrentPage ? "page" : undefined}
                >
                  {pageNum + 1}
                </Button>
              );
            })}
          </div>

          {/* Next page */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(page + 1)}
            disabled={!canGoNext || isLoading}
            aria-label="Go to next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Last page */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 hidden sm:flex"
            onClick={() => onPageChange(totalPages - 1)}
            disabled={!canGoNext || isLoading}
            aria-label="Go to last page"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Page info / Jump to page */}
        <div className="min-w-[100px] sm:min-w-[120px] text-right">
          {isEditingPage ? (
            <div className="flex items-center gap-1 text-sm justify-end">
              <span className="text-muted-foreground hidden sm:inline">
                Page
              </span>
              <Input
                ref={jumpToPageInputRef}
                type="number"
                min={1}
                max={totalPages}
                value={jumpToPageValue}
                onChange={e => setJumpToPageValue(e.target.value)}
                onKeyDown={handleJumpToPageKeyDown}
                onBlur={handleJumpToPageBlur}
                className="h-7 w-12 sm:w-14 text-center text-sm px-1"
                aria-label="Jump to page number"
              />
              <span className="text-muted-foreground whitespace-nowrap">
                of <span className="font-medium">{totalPages || 1}</span>
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handlePageInfoClick}
              disabled={isLoading || totalPages <= 1}
              className={cn(
                "text-sm px-2 py-1 rounded-none transition-colors whitespace-nowrap",
                totalPages > 1 &&
                  !isLoading &&
                  "hover-unified cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                (isLoading || totalPages <= 1) && "cursor-default"
              )}
              title={
                totalPages > 1 ? "Click to jump to a specific page" : undefined
              }
              aria-label={`Page ${displayPage} of ${totalPages || 1}. ${totalPages > 1 ? "Click to jump to a specific page." : ""}`}
            >
              <span className="hidden sm:inline">Page </span>
              <span className="font-medium">{displayPage}</span> /{" "}
              <span className="font-medium">{totalPages || 1}</span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
