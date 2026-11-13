"use client";

import * as React from "react";

import {
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
} from "@admin/components/icons";
import { PAGINATION } from "@admin/constants/pagination";
import { useT } from "@admin/lib/i18n/I18nProvider";
import { cn } from "@admin/lib/utils";

import {
  PAGER_BUTTON_SIZE,
  PAGER_CONTROLS,
  PAGER_COUNT,
  PAGER_FRAME,
  PAGER_NAV,
  PAGER_SIZE,
  PAGER_SIZE_BOX,
  PAGER_SIZE_LABEL,
  PAGER_SIZE_WORDS,
  PAGER_SUMMARY,
  pageCountText,
} from "./pager-layout";
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
  pageItemCount,
  pageSize,
  totalCapped,
  totalItems,
  totalPages,
}: {
  currentPage: number;
  itemLabel: string;
  pageItemCount: number | undefined;
  pageSize: number;
  totalCapped: boolean;
  totalItems: number | undefined;
  totalPages: number;
}): React.JSX.Element {
  /*
   * An absent total is not an empty one: a caller that cannot count says
   * nothing about how many rows exist, and gets the page-of-pages form.
   */
  if (totalItems === undefined) {
    return (
      <div className={PAGER_SUMMARY} data-slot="pagination-summary">
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
    <div className={PAGER_SUMMARY} data-slot="pagination-summary">
      {totalItems === 0 ? (
        <>No {itemLabel}</>
      ) : (
        <>
          Showing {currentPage * pageSize + 1}-
          {/* A capped total is a lower bound, so it does not end the range:
              a page past it shows its own rows. */}
          {totalCapped
            ? currentPage * pageSize + (pageItemCount ?? pageSize)
            : Math.min((currentPage + 1) * pageSize, totalItems)}{" "}
          of {totalItems}
          {totalCapped ? "+" : ""} {itemLabel}
        </>
      )}
    </div>
  );
}

/**
 * The window of page numbers around the current page, `maxVisiblePages` wide,
 * moved back from the end so it stays full near the last page.
 */
function pageWindow(
  currentPage: number,
  totalPages: number,
  maxVisiblePages: number
): { startPage: number; endPage: number } {
  const start = Math.max(0, currentPage - Math.floor(maxVisiblePages / 2));
  const endPage = Math.min(totalPages - 1, start + maxVisiblePages - 1);
  const startPage =
    endPage - start < maxVisiblePages - 1
      ? Math.max(0, endPage - maxVisiblePages + 1)
      : start;
  return { startPage, endPage };
}

/** One place in the page-number strip: a page's button, or a gap. */
type PageSlot =
  | { kind: "page"; page: number; label: "page" | "first" | "last" }
  | { kind: "gap"; key: "ellipsis-start" | "ellipsis-end" };

/**
 * What the page-number strip shows: every page when they fit, otherwise the
 * window around the current page, with the first page and the last one at
 * either end and a gap where pages are skipped. Past a capped count the last
 * page is not known, so a gap alone says that more pages follow.
 */
function pageSlots(
  currentPage: number,
  totalPages: number,
  maxVisiblePages: number,
  totalCapped: boolean
): PageSlot[] {
  const page = (n: number): PageSlot => ({
    kind: "page",
    page: n,
    label: "page",
  });
  if (totalPages <= maxVisiblePages) {
    return Array.from({ length: totalPages }, (_, i) => page(i));
  }
  const { startPage, endPage } = pageWindow(
    currentPage,
    totalPages,
    maxVisiblePages
  );
  const slots: PageSlot[] = [];
  if (startPage > 0) {
    slots.push({ kind: "page", page: 0, label: "first" });
  }
  if (startPage > 1) slots.push({ kind: "gap", key: "ellipsis-start" });
  for (let i = startPage; i <= endPage; i++) slots.push(page(i));
  const lastPageShown = !totalCapped && endPage < totalPages - 1;
  if (endPage < totalPages - (lastPageShown ? 2 : 1)) {
    slots.push({ kind: "gap", key: "ellipsis-end" });
  }
  if (lastPageShown) {
    slots.push({ kind: "page", page: totalPages - 1, label: "last" });
  }
  return slots;
}

/**
 * The strip of page-number buttons, with an ellipsis where pages are skipped.
 * Its own component, drawn from {@link pageSlots}, so the pager around it
 * stays readable.
 */
function PageNumbers({
  currentPage,
  totalPages,
  maxVisiblePages,
  isLoading,
  totalCapped,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  maxVisiblePages: number;
  isLoading: boolean;
  totalCapped: boolean;
  onPageChange: (page: number) => void;
}): React.JSX.Element {
  const t = useT();
  const slots = pageSlots(
    currentPage,
    totalPages,
    maxVisiblePages,
    totalCapped
  );
  return (
    <>
      {slots.map(slot =>
        slot.kind === "gap" ? (
          <span
            key={slot.key}
            // Square corners: the ellipsis sits inside the same
            // overlapped-border strip as the page buttons.
            className={cn(
              PAGER_BUTTON_SIZE,
              "flex items-center justify-center rounded-none  border border-border-strong bg-background text-muted-foreground text-xs -ml-px"
            )}
            aria-hidden="true"
          >
            ...
          </span>
        ) : (
          <button
            key={`page-${slot.page}`}
            onClick={() => onPageChange(slot.page)}
            disabled={isLoading}
            className={cn(
              // Square corners: page buttons overlap their borders (-ml-px)
              // into one continuous strip, which a radius would break apart.
              PAGER_BUTTON_SIZE,
              "flex items-center justify-center rounded-none text-xs z-10 -ml-px transition-colors focus:outline-none focus:border-primary cursor-pointer",
              currentPage === slot.page
                ? "bg-primary! text-primary-foreground border-primary! z-20"
                : "bg-background  border border-border-strong hover-unified disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            aria-label={
              slot.label === "page"
                ? t("nextly.pagination.page", { page: slot.page + 1 })
                : t(`nextly.pagination.${slot.label}`)
            }
            aria-current={
              slot.label === "page" && currentPage === slot.page
                ? "page"
                : undefined
            }
          >
            {slot.page + 1}
          </button>
        )
      )}
    </>
  );
}

/**
 * The page an arrow, Home or End key moves to, or null when that move is not
 * open (or the key is not one of them).
 */
function pageForKey(
  key: string,
  at: {
    currentPage: number;
    totalPages: number;
    canGoPrevious: boolean;
    canGoNext: boolean;
    canGoLast: boolean;
  }
): number | null {
  const moves: Record<string, [open: boolean, page: number]> = {
    ArrowLeft: [at.canGoPrevious, at.currentPage - 1],
    ArrowRight: [at.canGoNext, at.currentPage + 1],
    Home: [at.canGoPrevious, 0],
    End: [at.canGoLast, at.totalPages - 1],
  };
  const move = moves[key];
  return move?.[0] ? move[1] : null;
}

/**
 * The pager's keyboard: Arrow keys, Home and End move between pages while the
 * control has focus, never while a form control inside it has.
 */
function usePagerKeys(at: {
  isLoading: boolean;
  currentPage: number;
  totalPages: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  canGoLast: boolean;
  onPageChange: (page: number) => void;
}): (e: React.KeyboardEvent) => void {
  const {
    isLoading,
    currentPage,
    totalPages,
    canGoPrevious,
    canGoNext,
    canGoLast,
    onPageChange,
  } = at;
  return React.useCallback(
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

      const page = pageForKey(e.key, {
        currentPage,
        totalPages,
        canGoPrevious,
        canGoNext,
        canGoLast,
      });
      if (page !== null) {
        e.preventDefault();
        onPageChange(page);
      }
    },
    [
      isLoading,
      canGoPrevious,
      canGoNext,
      canGoLast,
      currentPage,
      totalPages,
      onPageChange,
    ]
  );
}

/**
 * The pager's buttons: first, previous, the page numbers between, next and
 * last. Last is offered only when the last page is known.
 */
function PagerButtons({
  currentPage,
  totalPages,
  canGoLast,
  isLoading,
  onPageChange,
  children,
}: {
  currentPage: number;
  totalPages: number;
  canGoLast: boolean;
  isLoading: boolean;
  onPageChange: (page: number) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const t = useT();
  const canGoPrevious = currentPage > 0;
  const canGoNext = currentPage < totalPages - 1;
  return (
    <div className={PAGER_NAV}>
      {/* First */}
      <button
        onClick={() => onPageChange(0)}
        disabled={!canGoPrevious || isLoading}
        className={cn(
          PAGER_BUTTON_SIZE,
          "hidden @md/content:flex items-center justify-center rounded-md  border border-border-strong bg-background hover-unified disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-primary z-10 cursor-pointer"
        )}
        aria-label={t("nextly.pagination.first")}
      >
        <ChevronsLeft className="h-4 w-4" />
      </button>

      {/* Previous */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={!canGoPrevious || isLoading}
        className={cn(
          PAGER_BUTTON_SIZE,
          "flex items-center justify-center rounded-md  border border-border-strong bg-background hover-unified disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-primary z-10 cursor-pointer"
        )}
        aria-label={t("nextly.pagination.previous")}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {/* Numbers */}
      <div className="flex">{children}</div>

      {/* Next */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={!canGoNext || isLoading}
        className={cn(
          PAGER_BUTTON_SIZE,
          "flex items-center justify-center rounded-md  border border-border-strong bg-background hover-unified disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-primary z-10 cursor-pointer"
        )}
        aria-label={t("nextly.pagination.next")}
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {/* Last */}
      <button
        onClick={() => onPageChange(totalPages - 1)}
        disabled={!canGoLast || isLoading}
        className={cn(
          PAGER_BUTTON_SIZE,
          "hidden @md/content:flex items-center justify-center rounded-md  border border-border-strong bg-background hover-unified disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-primary z-10 cursor-pointer"
        )}
        aria-label={t("nextly.pagination.last")}
      >
        <ChevronsRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * The landmark's accessible name: the caller's own as given, or the admin's
 * in the interface language.
 */
function landmarkName(
  ariaLabel: string | undefined,
  t: (key: "nextly.pagination.label") => string
): string {
  return ariaLabel ?? t("nextly.pagination.label");
}

/**
 * The rows-per-page selector. Its visible "Rows per page" text is also its
 * programmatic name, through `aria-labelledby`: the text is hidden in a narrow
 * container, and a name taken by reference still holds when the element
 * naming it is not displayed, where a `<label>` would leave the select
 * unnamed. The id is per instance, so two pagers on one page each keep their
 * own name.
 */
function PageSizeSelect({
  pageSize,
  options,
  disabled,
  onChange,
}: {
  pageSize: number;
  options: readonly number[];
  disabled: boolean;
  onChange: (pageSize: number) => void;
}): React.JSX.Element {
  const labelId = React.useId();
  return (
    <div className={PAGER_SIZE}>
      <span id={labelId} className={PAGER_SIZE_LABEL}>
        {PAGER_SIZE_WORDS}
      </span>
      <div className="relative">
        <select
          id="page-size"
          aria-labelledby={labelId}
          value={pageSize}
          onChange={e => onChange(Number(e.target.value))}
          disabled={disabled}
          className={cn(
            PAGER_SIZE_BOX,
            "appearance-none rounded-md  border border-input bg-background px-2 py-1 text-sm font-medium focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed hover-unified cursor-pointer"
          )}
        >
          {options.map(size => (
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
export const Pagination: React.ForwardRefExoticComponent<
  PaginationProps & React.RefAttributes<HTMLElement>
> = React.forwardRef<HTMLElement, PaginationProps>(
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
      totalCapped = false,
      pageItemCount,
      itemLabel = "items",
      ariaLabel,
      className,
    },
    ref
  ) => {
    // The controls' names read in the interface language; a caller's own
    // landmark name is shown as given.
    const t = useT();
    const canGoPrevious = currentPage > 0;
    const canGoNext = currentPage < totalPages - 1;
    // The last page is only known when the total is: past a capped count the
    // pager offers the next page, never a jump to an end it cannot see.
    const canGoLast = canGoNext && !totalCapped;

    /** Arrow/Home/End move between pages while the control has focus. */
    const handleKeyDown = usePagerKeys({
      isLoading,
      currentPage,
      totalPages,
      canGoPrevious,
      canGoNext,
      canGoLast,
      onPageChange,
    });

    return (
      <nav
        ref={ref}
        // Named for the loading outline's check: the outline draws a pager
        // under the same name, which must stand where this one lands.
        data-frame-part="list-pager"
        aria-label={landmarkName(ariaLabel, t)}
        onKeyDown={handleKeyDown}
        className={cn(PAGER_FRAME, className)}
      >
        {/* Left: Info */}
        <PaginationSummary
          currentPage={currentPage}
          itemLabel={itemLabel}
          pageItemCount={pageItemCount}
          pageSize={pageSize}
          totalCapped={totalCapped}
          totalItems={totalItems}
          totalPages={totalPages}
        />

        {/* Right: Controls */}
        <div className={PAGER_CONTROLS}>
          {/* Page size selector */}
          {showPageSizeSelector && onPageSizeChange && (
            <PageSizeSelect
              pageSize={pageSize}
              options={pageSizeOptions}
              disabled={isLoading}
              onChange={onPageSizeChange}
            />
          )}

          {/* Navigation Buttons Group */}
          <PagerButtons
            currentPage={currentPage}
            totalPages={totalPages}
            canGoLast={canGoLast}
            isLoading={isLoading}
            onPageChange={onPageChange}
          >
            <PageNumbers
              currentPage={currentPage}
              totalPages={totalPages}
              maxVisiblePages={maxVisiblePages}
              isLoading={isLoading}
              totalCapped={totalCapped}
              onPageChange={onPageChange}
            />
          </PagerButtons>

          {/* Page Count (Far Right) */}
          <div className={PAGER_COUNT}>
            {pageCountText(currentPage, totalPages, totalCapped)}
          </div>
        </div>
      </nav>
    );
  }
);

Pagination.displayName = "Pagination";
