import Image from "next/image";
import Link from "next/link";

import { CategoryBadge } from "./CategoryBadge";

import { formatPublishedDate } from "@/lib/format-date";
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

  const formattedDate = formatPublishedDate(publishedAt);

  return (
    <article
      className="group flex h-full flex-col overflow-hidden rounded-none border transition-all duration-300 hover:border-[color:var(--color-fg-muted)]"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg-surface)",
      }}
    >
      {/* Meta Top Row */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            ></path>
          </svg>
          {formattedDate && (
            <time dateTime={publishedAt ?? undefined}>{formattedDate}</time>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          {readingTime ? (
            <span>{readingTime} min read</span>
          ) : (
            <span>5 min read</span>
          )}
        </div>
      </div>

      <Link
        href={`/blog/${slug}`}
        className="relative block aspect-video overflow-hidden border-b"
        style={{ borderColor: "var(--color-border)" }}
        aria-label={title}
      >
        {featuredImage?.url ? (
          <Image
            src={featuredImage.url}
            alt={featuredImage.altText || title}
            width={720}
            height={405}
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-widest"
            style={{
              background: "var(--color-bg)",
              color: "var(--color-fg-muted)",
            }}
          >
            No preview
          </div>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-6">
        <h2
          className="mb-4 text-lg font-bold leading-tight tracking-tightest-premium"
          style={{ color: "var(--color-fg)" }}
        >
          <Link
            href={`/blog/${slug}`}
            className="transition-opacity hover:opacity-70"
          >
            {title}
          </Link>
        </h2>

        {excerpt && (
          <p
            className="mb-6 line-clamp-3 text-sm leading-relaxed"
            style={{ color: "var(--color-fg-muted)" }}
          >
            {excerpt}
          </p>
        )}

        <div className="mt-auto">
          {categories && categories.length > 0 && (
            <div className="mb-8 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {categories.map(cat => (
                <span key={cat.slug}>#{cat.name.replace(/\s+/g, "")}</span>
              ))}
            </div>
          )}

          <Link
            href={`/blog/${slug}`}
            className="flex items-center gap-4 group/link"
          >
            <span
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: "var(--color-fg)" }}
            >
              Read Perspectives
            </span>
            <div className="h-px flex-1 bg-slate-200 transition-colors group-hover/link:bg-slate-400" />
            <svg
              className="w-4 h-4 text-slate-400 transition-transform group-hover/link:translate-x-1"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              ></path>
            </svg>
          </Link>
        </div>
      </div>
    </article>
  );
}
