import Image from "next/image";
import Link from "next/link";

import { CategoryBadge } from "./CategoryBadge";

import type { Post } from "@/lib/queries/types";

/**
 * PostCard - a card showing a blog post preview in a grid.
 * Displays featured image, title, excerpt, author, date, reading time,
 * and categories.
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
    <article className="group flex flex-col">
      {/* Featured image with aspect ratio container */}
      <Link
        href={`/blog/${slug}`}
        className="relative mb-4 block overflow-hidden rounded-lg"
        aria-label={title}
      >
        {featuredImage?.url ? (
          <Image
            src={featuredImage.url}
            alt={featuredImage.altText || title}
            width={720}
            height={405}
            // One col on phones, two on tablets, three on desktop in the
            // max-w-5xl container. `sizes` lets Next.js pick the right
            // srcset candidate per breakpoint so phones don't download
            // a desktop-sized image.
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw"
            className="aspect-video w-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-neutral-100 text-sm text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            No image
          </div>
        )}
      </Link>

      {/* Category badges */}
      {categories && categories.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {categories.map(cat => (
            <CategoryBadge key={cat.slug} name={cat.name} slug={cat.slug} />
          ))}
        </div>
      )}

      {/* Title */}
      <h2 className="mb-2 text-lg font-semibold leading-snug tracking-tight text-neutral-900 dark:text-neutral-100">
        <Link
          href={`/blog/${slug}`}
          className="transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          {title}
        </Link>
      </h2>

      {/* Excerpt */}
      {excerpt && (
        <p className="mb-3 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">
          {excerpt}
        </p>
      )}

      {/* Author, date, reading time - pushed to bottom with mt-auto */}
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-500 dark:text-neutral-500">
        {author && (
          <Link
            href={`/authors/${author.slug}`}
            className="font-medium text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
          >
            {author.name}
          </Link>
        )}
        {author && formattedDate && <span aria-hidden="true">&middot;</span>}
        {formattedDate && (
          <time dateTime={publishedAt ?? undefined}>{formattedDate}</time>
        )}
        {readingTime && formattedDate && (
          <span aria-hidden="true">&middot;</span>
        )}
        {readingTime ? <span>{readingTime} min read</span> : null}
      </div>
    </article>
  );
}
