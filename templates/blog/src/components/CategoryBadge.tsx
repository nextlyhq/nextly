import Link from "next/link";

/**
 * CategoryBadge - a small linked pill that shows a category name.
 * Used on PostCard and single post pages.
 */

interface CategoryBadgeProps {
  name: string;
  slug: string;
}

export function CategoryBadge({ name, slug }: CategoryBadgeProps) {
  return (
    <Link
      href={`/categories/${slug}`}
      className="inline-block rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
    >
      {name}
    </Link>
  );
}
