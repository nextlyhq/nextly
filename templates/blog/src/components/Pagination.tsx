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
      className="flex flex-wrap items-center justify-center gap-2"
    >
      {/* Previous button */}
      {currentPage > 1 ? (
        <Link
          href={getPageUrl(currentPage - 1)}
          className="antigravity-press rounded-sm border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all hover:border-[color:var(--color-fg-muted)]"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
            color: "var(--color-fg)",
          }}
          aria-label="Previous page"
        >
          Prev
        </Link>
      ) : (
        <span
          className="rounded-sm border px-4 py-2 text-[10px] font-bold uppercase tracking-widest opacity-30"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
            color: "var(--color-fg)",
          }}
        >
          Prev
        </span>
      )}

      {/* Page numbers */}
      {pageNumbers.map(page => (
        <Link
          key={page}
          href={getPageUrl(page)}
          className={`antigravity-press flex h-9 w-9 items-center justify-center rounded-sm border text-[10px] font-bold uppercase transition-all ${
            page === currentPage
              ? "shadow-sm"
              : "hover:border-[color:var(--color-fg-muted)]"
          }`}
          style={{
            borderColor:
              page === currentPage ? "var(--color-fg)" : "var(--color-border)",
            background:
              page === currentPage
                ? "var(--color-fg)"
                : "var(--color-bg-surface)",
            color:
              page === currentPage
                ? "var(--color-bg-surface)"
                : "var(--color-fg)",
          }}
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
          className="antigravity-press rounded-sm border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all hover:border-[color:var(--color-fg-muted)]"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
            color: "var(--color-fg)",
          }}
          aria-label="Next page"
        >
          Next
        </Link>
      ) : (
        <span
          className="rounded-sm border px-4 py-2 text-[10px] font-bold uppercase tracking-widest opacity-30"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
            color: "var(--color-fg)",
          }}
        >
          Next
        </span>
      )}
    </nav>
  );
}
