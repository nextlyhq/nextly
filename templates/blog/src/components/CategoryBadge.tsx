import Link from "next/link";

/**
 * CategoryBadge - a small linked pill that shows a category name.
 * Used on PostCard and single post pages. Uses design tokens so it
 * adapts to light + dark modes without Tailwind dark: variants.
 */

interface CategoryBadgeProps {
  name: string;
  slug: string;
}

export function CategoryBadge({ name, slug }: CategoryBadgeProps) {
  return (
    <Link
      href={`/categories/${slug}`}
      className="inline-block rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest transition-opacity hover:opacity-70"
      style={{
        background: "var(--color-tag-bg)",
        color: "var(--color-tag-fg)",
      }}
    >
      {name}
    </Link>
  );
}
