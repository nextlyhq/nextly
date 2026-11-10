"use client";

/**
 * The releases a Needs your attention row counts, named under it, each linked
 * to its page: "Releases that stopped · 1" says how many, and these say which.
 *
 * Read from the Releases list's own Needs attention tab, narrowed to the row's
 * part, so the names are exactly the releases the row's Review leads to. The
 * first few only, as the row's Review lists every one; nothing is drawn while
 * the read is on its way or when it failed, since the row's count and Review
 * already stand for them.
 *
 * @module components/features/dashboard/AttentionReleaseNames
 */
import type { JSX } from "react";

import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useReleasesNeedingAttention } from "@admin/hooks/queries/useReleases";
import type { ReleaseAttentionReason } from "@admin/types/releases";

/** How many releases a row names: the row's Review lists the rest. */
const NAMED_RELEASES = 3;

export function AttentionReleaseNames({
  reason,
}: {
  reason: ReleaseAttentionReason;
}): JSX.Element | null {
  const read = useReleasesNeedingAttention(NAMED_RELEASES, reason);
  const releases = read.data?.items ?? [];
  if (releases.length === 0) return null;
  return (
    <ul
      aria-label={
        reason === "stopped" ? "Stopped releases" : "Overdue releases"
      }
      // Indented to the row's text, past its severity mark, so the names read
      // as the row's own.
      className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 pb-2 pl-9 text-xs"
    >
      {releases.map(release => (
        <li key={release.id} className="min-w-0 max-w-full truncate">
          <Link
            href={buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })}
            className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {release.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}
