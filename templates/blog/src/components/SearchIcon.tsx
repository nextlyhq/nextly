import Link from "next/link";

/**
 * SearchIcon - magnifier button that navigates to the dedicated
 * `/search` page (implemented in Task 17 Sub-task 11 via Pagefind).
 * Rendered in the Header's right-side icon cluster when
 * Navigation.showSearchIcon is true.
 */

export function SearchIcon() {
  return (
    <Link
      href="/search"
      aria-label="Search"
      title="Search"
      className="flex h-8 w-8 items-center justify-center rounded-full border transition-colors"
      style={{
        borderColor: "var(--color-border)",
        color: "var(--color-fg-muted)",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
    </Link>
  );
}
