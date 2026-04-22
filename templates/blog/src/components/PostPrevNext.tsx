import Link from "next/link";

import type { Post } from "@/lib/queries/types";

/**
 * PostPrevNext - two cards linking to the chronologically adjacent
 * published posts: "Previous" (older) on the left, "Next" (newer) on
 * the right.
 *
 * Either side can be null (first post has no Previous, latest has no
 * Next). When one side is missing, the other still renders on the
 * correct edge via grid placement.
 */

interface PostPrevNextProps {
  previous: Pick<Post, "title" | "slug"> | null;
  next: Pick<Post, "title" | "slug"> | null;
}

export function PostPrevNext({ previous, next }: PostPrevNextProps) {
  if (!previous && !next) return null;

  return (
    <nav
      aria-label="Post navigation"
      className="mt-12 grid gap-4 sm:grid-cols-2"
    >
      {previous ? (
        <Link
          href={`/blog/${previous.slug}`}
          className="group flex flex-col gap-1 rounded-xl border p-4 transition-colors hover:opacity-90"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
          }}
        >
          <span
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "var(--color-fg-muted)" }}
          >
            ← Previous
          </span>
          <span
            className="text-sm font-medium leading-snug"
            style={{ color: "var(--color-fg)" }}
          >
            {previous.title}
          </span>
        </Link>
      ) : (
        <div aria-hidden="true" />
      )}

      {next ? (
        <Link
          href={`/blog/${next.slug}`}
          className="group flex flex-col items-end gap-1 rounded-xl border p-4 text-right transition-colors hover:opacity-90"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-surface)",
          }}
        >
          <span
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "var(--color-fg-muted)" }}
          >
            Next →
          </span>
          <span
            className="text-sm font-medium leading-snug"
            style={{ color: "var(--color-fg)" }}
          >
            {next.title}
          </span>
        </Link>
      ) : (
        <div aria-hidden="true" />
      )}
    </nav>
  );
}
