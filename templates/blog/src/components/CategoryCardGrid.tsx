import Link from "next/link";

import type { Category, TaxonomyWithCount } from "@/lib/queries/types";

/**
 * CategoryCardGrid - the content of the /categories index page.
 * Two-column card grid on desktop, single-column on mobile. Each card
 * shows the category name, description, and post count. Designed for
 * a small-to-medium number of categories (5-15). If you have many
 * more, switch to the TagCloud pattern instead.
 */

interface CategoryCardGridProps {
  categories: TaxonomyWithCount<Category>[];
}

export function CategoryCardGrid({ categories }: CategoryCardGridProps) {
  if (categories.length === 0) {
    return <p style={{ color: "var(--color-fg-muted)" }}>No categories yet.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {categories.map(({ item, postCount }) => (
        <Link
          key={item.slug}
          href={`/categories/${item.slug}`}
          className="group flex flex-col gap-3 rounded-xl border p-5 transition-colors hover:opacity-95"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
          }}
        >
          <h3
            className="text-xl font-semibold tracking-tight"
            style={{ color: "var(--color-fg)" }}
          >
            {item.name}
          </h3>
          {item.description && (
            <p
              className="line-clamp-3 text-sm leading-relaxed"
              style={{ color: "var(--color-fg-muted)" }}
            >
              {item.description}
            </p>
          )}
          <div
            className="mt-auto border-t pt-3 text-xs"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-fg-muted)",
            }}
          >
            {postCount} {postCount === 1 ? "post" : "posts"}
          </div>
        </Link>
      ))}
    </div>
  );
}
