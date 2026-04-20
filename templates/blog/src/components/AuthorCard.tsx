import Image from "next/image";
import Link from "next/link";

import type { Author } from "@/lib/queries/types";

/**
 * AuthorCard - displays author avatar, name, and bio.
 * Used on single post pages (compact variant) and author profile pages
 * (full variant).
 */

interface AuthorCardProps {
  author: Author;
  /** "compact" for post footer, "full" for author profile page */
  variant?: "compact" | "full";
}

export function AuthorCard({ author, variant = "compact" }: AuthorCardProps) {
  const { name, slug, bio, avatar } = author;

  if (variant === "full") {
    return (
      <div className="flex flex-col items-center text-center">
        {avatar?.url ? (
          <Image
            src={avatar.url}
            alt={avatar.altText || name}
            width={96}
            height={96}
            sizes="96px"
            className="mb-4 rounded-full object-cover"
          />
        ) : (
          <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-neutral-200 text-2xl font-semibold text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
            {name.charAt(0)}
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          {name}
        </h1>
        {bio && (
          <p className="mt-2 max-w-md text-neutral-600 dark:text-neutral-400">
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
      className="flex items-center gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
    >
      {avatar?.url ? (
        <Image
          src={avatar.url}
          alt={avatar.altText || name}
          width={48}
          height={48}
          sizes="48px"
          className="rounded-full object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-200 text-lg font-semibold text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
          {name.charAt(0)}
        </div>
      )}
      <div>
        <p className="font-medium text-neutral-900 dark:text-neutral-100">
          {name}
        </p>
        {bio && (
          <p className="line-clamp-1 text-sm text-neutral-500 dark:text-neutral-400">
            {bio}
          </p>
        )}
      </div>
    </Link>
  );
}
