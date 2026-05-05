import Image from "next/image";
import Link from "next/link";

import type { Author } from "@/lib/queries/types";

/**
 * AuthorCard - displays author avatar, name, and bio.
 *
 * Used on single post pages (compact variant) and author profile pages
 * (full variant). Avatar is a plain URL string (not an uploaded Media
 * record) because user-extension fields only support scalar types today.
 *
 * `unoptimized` is set on the Image because avatarUrl can point at any
 * remote host (gravatar, external CDN, GitHub raw) - not necessarily one
 * listed in `next.config.images.remotePatterns`. Users who want
 * optimized avatars can either add their avatar host to that allowlist
 * and drop `unoptimized`, or swap avatarUrl for an upload-backed media
 * relation.
 *
 * Falls back to an initial-letter chip when no URL is provided.
 */

interface AuthorCardProps {
  author: Author;
  /** "compact" for post footer, "full" for author profile page */
  variant?: "compact" | "full";
}

export function AuthorCard({ author, variant = "compact" }: AuthorCardProps) {
  const { name, slug, bio, avatarUrl } = author;

  if (variant === "full") {
    return (
      <div className="flex flex-col items-center text-center">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={name}
            width={120}
            height={120}
            unoptimized
            className="mb-6 rounded-full border-4 border-[color:var(--color-bg-surface)] object-cover shadow-sm"
          />
        ) : (
          <div
            className="mb-6 flex h-24 w-24 items-center justify-center rounded-full text-2xl font-bold"
            style={{
              background: "var(--color-tag-bg)",
              color: "var(--color-tag-fg)",
            }}
          >
            {name.charAt(0)}
          </div>
        )}
        <h1
          className="text-3xl font-bold tracking-tightest-premium"
          style={{ color: "var(--color-fg)" }}
        >
          {name}
        </h1>
        {bio && (
          <p
            className="mt-4 max-w-md text-base leading-relaxed"
            style={{ color: "var(--color-fg-muted)" }}
          >
            {bio}
          </p>
        )}
      </div>
    );
  }

  // Compact variant - used in post footer
  return (
    <Link
      href={`/authors/${slug}`}
      className="group flex items-center gap-4 rounded-lg border p-5 transition-all hover:border-[color:var(--color-fg-muted)]"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg-surface)",
      }}
    >
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={name}
          width={56}
          height={56}
          unoptimized
          className="rounded-full object-cover grayscale transition-all group-hover:grayscale-0"
        />
      ) : (
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold"
          style={{
            background: "var(--color-tag-bg)",
            color: "var(--color-tag-fg)",
          }}
        >
          {name.charAt(0)}
        </div>
      )}
      <div className="flex-1">
        <p
          className="font-bold tracking-tight"
          style={{ color: "var(--color-fg)" }}
        >
          {name}
        </p>
        {bio && (
          <p
            className="mt-1 line-clamp-1 text-sm leading-relaxed"
            style={{ color: "var(--color-fg-muted)" }}
          >
            {bio}
          </p>
        )}
      </div>
      <div
        className="text-xs font-bold uppercase tracking-widest opacity-0 transition-opacity group-hover:opacity-100"
        style={{ color: "var(--color-accent)" }}
      >
        Profile →
      </div>
    </Link>
  );
}
