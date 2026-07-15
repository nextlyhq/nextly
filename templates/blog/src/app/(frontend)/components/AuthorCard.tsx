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
    <div
      className="group relative border p-8 transition-all md:p-10"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg-surface)",
      }}
    >
      <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-10">
        {/* Avatar with architectural frame */}
        <Link href={`/authors/${slug}`} className="relative shrink-0">
          {avatarUrl ? (
            <div className="relative h-20 w-20 overflow-hidden rounded-full border border-black/10 transition-transform duration-500 group-hover:scale-105 dark:border-white/10">
              <Image
                src={avatarUrl}
                alt={name}
                width={80}
                height={80}
                unoptimized
                className="h-full w-full object-cover grayscale transition-all duration-700 group-hover:grayscale-0"
              />
            </div>
          ) : (
            <div
              className="flex h-20 w-20 items-center justify-center rounded-full border border-black/10 text-xl font-bold dark:border-white/10"
              style={{
                background: "var(--color-bg)",
                color: "var(--color-fg)",
              }}
            >
              {name.charAt(0)}
            </div>
          )}
        </Link>

        {/* Content */}
        <div className="flex-1">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p
                className="text-[10px] font-bold uppercase tracking-widest-premium opacity-40"
                style={{ color: "var(--color-fg)" }}
              >
                Written by
              </p>
              <Link
                href={`/authors/${slug}`}
                className="text-2xl font-bold tracking-tight transition-all hover:opacity-70"
                style={{ color: "var(--color-fg)" }}
              >
                {name}
              </Link>
            </div>
          </div>
          {bio && (
            <p
              className="max-w-2xl text-base leading-relaxed"
              style={{ color: "var(--color-fg-muted)" }}
            >
              {bio}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
