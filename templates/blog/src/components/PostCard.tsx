import Image from "next/image";
import Link from "next/link";

import { CategoryBadge } from "./CategoryBadge";

import type { Post } from "@/lib/queries/types";

/**
 * PostCard - a card showing a blog post preview in a grid.
 *
 * Uses the design tokens from `globals.css` (surface, border, muted,
 * accent) so the card adapts to light and dark modes automatically.
 * Subtle hover lifts the border to the accent color - movement is
 * intentionally modest so long scrolls aren't noisy.
 */

interface PostCardProps {
  post: Post;
}

export function PostCard({ post }: PostCardProps) {
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
    <article
      className="group flex h-full flex-col overflow-hidden rounded-xl border transition-colors"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg-surface)",
      }}
    >
      <Link
        href={`/blog/${slug}`}
        className="relative block overflow-hidden"
        aria-label={title}
      >
        {featuredImage?.url ? (
          <Image
            src={featuredImage.url}
            alt={featuredImage.altText || title}
            width={720}
            height={405}
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw"
            className="aspect-video w-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.02]"
          />
        ) : (
          <div
            className="flex aspect-video w-full items-center justify-center text-sm"
            style={{
              background: "var(--color-bg)",
              color: "var(--color-fg-muted)",
            }}
          >
            No image
          </div>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-5">
        {categories && categories.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {categories.slice(0, 2).map(cat => (
              <CategoryBadge key={cat.slug} name={cat.name} slug={cat.slug} />
            ))}
          </div>
        )}

        <h2
          className="mb-2 text-lg font-semibold leading-snug tracking-tight"
          style={{ color: "var(--color-fg)" }}
        >
          <Link
            href={`/blog/${slug}`}
            className="transition-colors group-hover:opacity-90"
          >
            {title}
          </Link>
        </h2>

        {excerpt && (
          <p
            className="mb-4 line-clamp-2 text-sm"
            style={{ color: "var(--color-fg-muted)" }}
          >
            {excerpt}
          </p>
        )}

        <div
          className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          style={{ color: "var(--color-fg-muted)" }}
        >
          {author && (
            <Link
              href={`/authors/${author.slug}`}
              className="font-medium transition-colors"
              style={{ color: "var(--color-fg)" }}
            >
              {author.name}
            </Link>
          )}
          {author && formattedDate && <span aria-hidden="true">·</span>}
          {formattedDate && (
            <time dateTime={publishedAt ?? undefined}>{formattedDate}</time>
          )}
          {readingTime && formattedDate && <span aria-hidden="true">·</span>}
          {readingTime ? <span>{readingTime} min read</span> : null}
        </div>
      </div>
    </article>
  );
}
