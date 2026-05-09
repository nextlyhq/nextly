/**
 * Loading skeleton for the frontend route group.
 *
 * Next.js streams this while a Server Component's data-fetching
 * suspends, so users see the layout + a placeholder grid instead of
 * a blank screen. Shape mirrors PostGrid (1/2/3 cols responsive).
 */

export default function Loading() {
  return (
    <div>
      <div className="mb-8 h-8 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="mb-4 aspect-video rounded-lg bg-neutral-200 dark:bg-neutral-800" />
            <div className="mb-2 h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-4 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
