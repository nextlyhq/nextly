import Link from "next/link";

import type { Category } from "@/lib/queries/types";

/**
 * CategoryStrip - horizontal row of clickable category chips on the
 * homepage. Overflows gracefully on mobile (horizontal scroll) so
 * sites with many categories still look intentional.
 */

interface CategoryStripProps {
  categories: Category[];
}

export function CategoryStrip({ categories }: CategoryStripProps) {
  if (categories.length === 0) return null;

  return (
    <section className="mb-16">
      <h2
        className="mb-6 text-xs font-semibold uppercase tracking-widest"
        style={{ color: "var(--color-fg-muted)" }}
      >
        Browse by Topic
      </h2>
      <div className="flex flex-wrap gap-2 sm:gap-3">
        {categories.map(cat => (
          <Link
            key={cat.slug}
            href={`/categories/${cat.slug}`}
            className="rounded-full border px-4 py-2 text-sm font-medium transition-colors hover:opacity-90"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg-surface)",
              color: "var(--color-fg)",
            }}
          >
            {cat.name}
          </Link>
        ))}
      </div>
    </section>
  );
}
