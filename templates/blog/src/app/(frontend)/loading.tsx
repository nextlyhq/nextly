/**
 * Loading skeleton for the frontend route group.
 *
 * Next.js streams this while a Server Component's data-fetching
 * suspends, so users see the layout + a placeholder grid instead of
 * a blank screen. Shape mirrors PostCard structure exactly.
 */

function PostCardSkeleton() {
  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-none border transition-all"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg-surface)",
      }}
    >
      {/* Meta Top Row - Date and Reading Time */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          {/* Calendar Icon Skeleton */}
          <div className="h-3 w-3 animate-pulse rounded-sm bg-neutral-200 dark:bg-neutral-800" />
          {/* Date Skeleton */}
          <div className="h-3 w-20 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        </div>
        <div className="flex items-center gap-1.5">
          {/* Clock Icon Skeleton */}
          <div className="h-3.5 w-3.5 animate-pulse rounded-sm bg-neutral-200 dark:bg-neutral-800" />
          {/* Reading Time Skeleton */}
          <div className="h-3 w-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        </div>
      </div>

      {/* Featured Image Skeleton */}
      <div
        className="aspect-video animate-pulse bg-neutral-200 dark:bg-neutral-800 border-b"
        style={{ borderColor: "var(--color-border)" }}
      />

      {/* Content Section */}
      <div className="flex flex-1 flex-col p-6">
        {/* Title Skeleton - 2 lines */}
        <div className="mb-4 space-y-2">
          <div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        </div>

        {/* Excerpt Skeleton - 3 lines */}
        <div className="mb-6 space-y-2">
          <div className="h-3.5 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-3.5 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        </div>

        {/* Bottom Section */}
        <div className="mt-auto">
          {/* Category Badges Skeleton */}
          <div className="mb-8 flex gap-2">
            <div className="h-4 w-16 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-4 w-20 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-800" />
          </div>

          {/* "Read Perspectives" Link Skeleton */}
          <div className="flex items-center gap-4">
            <div className="h-3 w-28 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-px flex-1 animate-pulse bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-4 w-4 animate-pulse rounded-sm bg-neutral-200 dark:bg-neutral-800" />
          </div>
        </div>
      </div>
    </article>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-20 md:py-32">
      {/* Page Header Skeleton */}
      <div className="mb-8 h-8 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />

      {/* Post Grid Skeleton */}
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <PostCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
