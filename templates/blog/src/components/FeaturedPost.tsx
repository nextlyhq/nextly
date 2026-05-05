import Image from "next/image";
import Link from "next/link";

import { CategoryBadge } from "./CategoryBadge";

import { formatPublishedDate } from "@/lib/format-date";
import type { Post } from "@/lib/queries/types";

/**
 * FeaturedPost - large hero card for the homepage Featured slot.
 *
 * Larger than a PostCard; uses a two-column layout on desktop (image
 * left, meta + title + excerpt + author right). On mobile the image
 * stacks on top.
 *
 * Parent decides which post to feature - typically the post marked
 * `featured: true`, with the latest post as fallback. See
 * `src/lib/queries/posts.ts:getFeaturedPost`.
 */

interface FeaturedPostProps {
  post: Post;
  sectionTitle?: string;
}

export function FeaturedPost({
  post,
  sectionTitle = "Featured",
}: FeaturedPostProps) {
  const {
    title,
    slug,
    excerpt,
    featuredImage,
    author,
    categories,
    publishedAt,
    readingTime,
  } = post;

  const formattedDate = formatPublishedDate(publishedAt);

  return (
    <section
      className="w-full border-b"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-32">
        <div className="mb-8 flex items-center gap-4">
          <h2
            className="text-lg font-bold tracking-tight"
            style={{ color: "var(--color-fg)" }}
          >
            {sectionTitle}
          </h2>
          <div
            className="h-px flex-1"
            style={{ background: "var(--color-border)" }}
          />
        </div>

        <article
          className="group overflow-hidden rounded-none border transition-all duration-500 hover:border-[color:var(--color-fg-muted)] w-full"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
          }}
        >
          <div className="grid gap-0 md:grid-cols-2">
            {/* Image (clickable) */}
            <Link
              href={`/blog/${slug}`}
              aria-label={title}
              className="block aspect-video overflow-hidden md:aspect-auto md:h-full"
            >
              {featuredImage?.url ? (
                <Image
                  src={featuredImage.url}
                  alt={featuredImage.altText || title}
                  width={800}
                  height={450}
                  unoptimized
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  sizes="(min-width: 768px) 50vw, 100vw"
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center text-xs uppercase tracking-widest"
                  style={{
                    background: "var(--color-bg)",
                    color: "var(--color-fg-muted)",
                  }}
                >
                  No preview
                </div>
              )}
            </Link>

            {/* Text */}
            <div className="flex flex-col justify-center gap-6 p-8 md:p-14">
              {categories && categories.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {categories.slice(0, 1).map(cat => (
                    <CategoryBadge
                      key={cat.slug}
                      name={cat.name}
                      slug={cat.slug}
                    />
                  ))}
                </div>
              )}
              <h3
                className="text-xl font-bold leading-[1.1] tracking-tighter-premium sm:text-2xl"
                style={{ color: "var(--color-fg)" }}
              >
                <Link
                  href={`/blog/${slug}`}
                  className="transition-opacity hover:opacity-70"
                >
                  {title}
                </Link>
              </h3>
              {excerpt && (
                <p
                  className="text-sm leading-relaxed sm:text-base"
                  style={{ color: "var(--color-fg-muted)" }}
                >
                  {excerpt}
                </p>
              )}
              <div
                className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest"
                style={{ color: "var(--color-fg-muted)" }}
              >
                {author && (
                  <span style={{ color: "var(--color-fg)" }}>
                    {author.name}
                  </span>
                )}
                {author && formattedDate && (
                  <span className="opacity-30">/</span>
                )}
                {formattedDate && (
                  <time dateTime={publishedAt ?? undefined}>
                    {formattedDate}
                  </time>
                )}
                {readingTime && <span className="opacity-30">/</span>}
                {readingTime ? <span>{readingTime} min read</span> : null}
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
