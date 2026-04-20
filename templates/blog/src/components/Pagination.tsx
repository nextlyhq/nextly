import Link from "next/link";

/**
 * Pagination - URL-based page navigation.
 * Uses searchParams (?page=2) for bookmarkable, shareable links.
 * No client-side state needed - fully server-rendered.
 */

interface PaginationProps {
  /** Current page number (1-indexed) */
  currentPage: number;
  /** Total number of pages */
  totalPages: number;
  /** Base path for pagination links (e.g., "/blog") */
  basePath: string;
}

export function Pagination({
  currentPage,
  totalPages,
  basePath,
}: PaginationProps) {
  // Don't render pagination if there's only one page
  if (totalPages <= 1) return null;

  // Build page link with optional page param (page 1 has no param for clean URLs)
  const getPageUrl = (page: number) => {
    if (page === 1) return basePath;
    return `${basePath}?page=${page}`;
  };

  // Generate visible page numbers (show up to 5 pages centered around current)
  const getPageNumbers = (): number[] => {
    const pages: number[] = [];
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);

    // Adjust start if we're near the end
    start = Math.max(1, end - 4);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-center gap-1"
    >
      {/* Previous button */}
      {currentPage > 1 ? (
        <Link
          href={getPageUrl(currentPage - 1)}
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          aria-label="Previous page"
        >
          Previous
        </Link>
      ) : (
        <span className="rounded-md px-3 py-2 text-sm font-medium text-neutral-300 dark:text-neutral-700">
          Previous
        </span>
      )}

      {/* Page numbers */}
      {pageNumbers.map(page => (
        <Link
          key={page}
          href={getPageUrl(page)}
          className={`min-w-[2.25rem] rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
            page === currentPage
              ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
              : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          }`}
          aria-current={page === currentPage ? "page" : undefined}
          aria-label={`Page ${page}`}
        >
          {page}
        </Link>
      ))}

      {/* Next button */}
      {currentPage < totalPages ? (
        <Link
          href={getPageUrl(currentPage + 1)}
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          aria-label="Next page"
        >
          Next
        </Link>
      ) : (
        <span className="rounded-md px-3 py-2 text-sm font-medium text-neutral-300 dark:text-neutral-700">
          Next
        </span>
      )}
    </nav>
  );
}
