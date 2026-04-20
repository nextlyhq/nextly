import Link from "next/link";

/**
 * Header - site navigation bar with logo/site name and nav links.
 * Receives site settings data as props from the layout.
 */

interface HeaderProps {
  siteName: string;
}

export function Header({ siteName }: HeaderProps) {
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6">
        <Link
          href="/"
          className="truncate text-lg font-bold tracking-tight text-neutral-900 dark:text-neutral-100"
        >
          {siteName || "My Blog"}
        </Link>

        <nav className="flex items-center gap-4 sm:gap-6">
          <Link
            href="/blog"
            className="text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Blog
          </Link>
          <Link
            href="/tags"
            className="text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Tags
          </Link>
        </nav>
      </div>
    </header>
  );
}
