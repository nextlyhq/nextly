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
    <section className="w-full" style={{ background: "var(--color-bg)" }}>
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-32">
        <div className="mb-12 flex items-center gap-4">
          <h2
            className="text-3xl font-bold tracking-tight"
            style={{ color: "var(--color-fg)" }}
          >
            Browse by Topic
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map(cat => (
            <Link
              key={cat.slug}
              href={`/categories/${cat.slug}`}
              className="group flex flex-col justify-between rounded-none border p-8 transition-all hover:border-[color:var(--color-fg-muted)] hover:shadow-sm"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-bg-surface)",
              }}
            >
              <div>
                <div className="mb-6 flex h-12 w-12 items-center justify-center bg-slate-50 text-slate-900 rounded-none border border-slate-200">
                  {getCategoryIcon(cat.slug)}
                </div>
                <h3
                  className="text-xl font-bold tracking-tightest-premium"
                  style={{ color: "var(--color-fg)" }}
                >
                  {cat.name}
                </h3>
              </div>
              <div className="mt-10 flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-colors group-hover:text-[color:var(--color-fg)]">
                  Explore Topic
                </span>
                <div className="h-px flex-1 bg-slate-100 transition-colors group-hover:bg-slate-200" />
                <svg
                  className="w-4 h-4 text-slate-400 transition-transform group-hover:translate-x-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    d="M14 5l7 7m0 0l-7 7m7-7H3"
                  ></path>
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function getCategoryIcon(slug: string) {
  switch (slug) {
    case "server-components":
      return (
        <svg
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M5 12h14M5 12l4-4m-4 4l4 4m5-4l4-4m-4 4l4 4"
          />
        </svg>
      );
    case "typescript":
      return (
        <svg
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
          />
        </svg>
      );
    case "performance":
      return (
        <svg
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      );
    case "design":
      return (
        <svg
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
          />
        </svg>
      );
    default:
      return (
        <svg
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
      );
  }
}
