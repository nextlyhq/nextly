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
    <div className="grid gap-6 sm:grid-cols-2">
      {categories.map(({ item, postCount }) => (
        <Link
          key={item.slug}
          href={`/categories/${item.slug}`}
          className="group flex flex-col gap-4 rounded-xl border p-8 transition-all hover:border-[color:var(--color-fg-muted)]"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
          }}
        >
          <h3
            className="text-2xl font-bold tracking-tightest-premium"
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
            className="mt-auto flex items-center justify-between border-t pt-6 text-[10px] font-bold uppercase tracking-widest"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-fg-muted)",
            }}
          >
            <span>
              {postCount} {postCount === 1 ? "post" : "posts"}
            </span>
            <span
              className="opacity-0 transition-opacity group-hover:opacity-100"
              style={{ color: "var(--color-accent)" }}
            >
              Explore →
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
