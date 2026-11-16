"use client";

/**
 * The releases a Needs your attention row counts, named under it, each linked
 * to its page: "Releases that stopped · 1" says how many, and these say which.
 *
 * Read from the Releases list's own Needs attention tab, narrowed to the row's
 * part, so the names are exactly the releases the row's Review leads to. The
 * first few only, as the row's Review lists every one. While the read is on
 * its way the names' line is held empty, so the rows under this one do not
 * move down when the names land; nothing is drawn when it failed or found
 * none, since the row's count and Review already stand for them.
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

/**
 * The names' line: indented to the row's text, past its severity mark, so the
 * names read as the row's own, in small text, with the space under it. The
 * line held while the names are on their way is drawn with the same classes,
 * so it is exactly as tall.
 */
const NAMES_LINE = "pb-2 pl-9 text-xs";

export function AttentionReleaseNames({
  reason,
}: {
  reason: ReleaseAttentionReason;
}): JSX.Element | null {
  const read = useReleasesNeedingAttention(NAMED_RELEASES, reason);
  const releases = read.data?.items ?? [];
  if (read.isPending) {
    // One line of the names' own size and spacing, empty: a row that counts
    // releases names at least one, so its line is as good as there.
    return (
      <div aria-hidden className={NAMES_LINE}>
        {"\u00a0"}
      </div>
    );
  }
  if (releases.length === 0) return null;
  return (
    <ul
      aria-label={
        reason === "stopped" ? "Stopped releases" : "Overdue releases"
      }
      className={`flex min-w-0 flex-wrap gap-x-3 gap-y-1 ${NAMES_LINE}`}
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
