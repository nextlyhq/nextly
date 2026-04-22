import Image from "next/image";
import Link from "next/link";

import { CategoryBadge } from "./CategoryBadge";

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

  const formattedDate = publishedAt
    ? new Date(publishedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <section className="mb-16">
      <h2
        className="mb-6 text-xs font-semibold uppercase tracking-widest"
        style={{ color: "var(--color-fg-muted)" }}
      >
        {sectionTitle}
      </h2>

      {/* Wrapping the whole card in a <Link> caused a nested-<a> hydration
          error because CategoryBadge is itself a <Link> to /categories/[slug].
          Each inner link gets its own <Link>; the image + title get theirs,
          and the card-level hover state is driven by a CSS `group` on the
          wrapping <article>. */}
      <article
        className="group overflow-hidden rounded-xl border transition-colors"
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
            className="block aspect-video md:aspect-auto md:h-full"
          >
            {featuredImage?.url ? (
              <Image
                src={featuredImage.url}
                alt={featuredImage.altText || title}
                width={800}
                height={450}
                unoptimized
                className="h-full w-full object-cover"
                sizes="(min-width: 768px) 50vw, 100vw"
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center text-sm"
                style={{
                  background: "var(--color-bg)",
                  color: "var(--color-fg-muted)",
                }}
              >
                No image
              </div>
            )}
          </Link>

          {/* Text */}
          <div className="flex flex-col justify-center gap-4 p-6 md:p-10">
            {categories && categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {categories.slice(0, 2).map(cat => (
                  <CategoryBadge
                    key={cat.slug}
                    name={cat.name}
                    slug={cat.slug}
                  />
                ))}
              </div>
            )}
            <h3
              className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl"
              style={{ color: "var(--color-fg)" }}
            >
              <Link
                href={`/blog/${slug}`}
                className="transition-colors hover:opacity-90"
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
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
              style={{ color: "var(--color-fg-muted)" }}
            >
              {author && (
                <span style={{ color: "var(--color-fg)" }}>{author.name}</span>
              )}
              {author && formattedDate && <span aria-hidden="true">·</span>}
              {formattedDate && (
                <time dateTime={publishedAt ?? undefined}>{formattedDate}</time>
              )}
              {readingTime && <span aria-hidden="true">·</span>}
              {readingTime ? <span>{readingTime} min read</span> : null}
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}
