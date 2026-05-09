import Link from "next/link";

import type { Tag, TaxonomyWithCount } from "@/lib/queries/types";

/**
 * TagCloud - the content of the /tags index page. Renders every tag
 * as a linked chip, with chip size based on post count bucket (small
 * 1-2, medium 3-5, large 6+). The size differentiation helps readers
 * see which topics the blog writes about most.
 */

interface TagCloudProps {
  tags: TaxonomyWithCount<Tag>[];
}

function sizeClass(count: number): string {
  if (count >= 6) return "text-base font-semibold px-4 py-1.5";
  if (count >= 3) return "text-sm font-medium px-3.5 py-1.5";
  return "text-xs px-3 py-1";
}

export function TagCloud({ tags }: TagCloudProps) {
  if (tags.length === 0) {
    return <p style={{ color: "var(--color-fg-muted)" }}>No tags yet.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-3 sm:gap-4">
      {tags.map(({ item, postCount }) => (
        <Link
          key={item.slug}
          href={`/tags/${item.slug}`}
          className={`inline-flex items-center gap-2 rounded-sm border transition-all hover:border-[color:var(--color-fg-muted)] ${sizeClass(
            postCount
          )}`}
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
            color: "var(--color-fg)",
          }}
        >
          <span className="font-bold uppercase tracking-widest">
            {item.name}
          </span>
          <span
            className="text-[10px] opacity-40"
            style={{ color: "var(--color-fg)" }}
          >
            {postCount}
          </span>
        </Link>
      ))}
    </div>
  );
}
