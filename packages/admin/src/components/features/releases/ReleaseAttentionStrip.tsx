"use client";

/**
 * The strip at the top of the Releases page, drawn while any release is
 * stopped or overdue.
 *
 * It names the first few of them, each with its state and linked to its page,
 * says how many there are in all, and leads to the Needs attention tab, where
 * all of them are. What counts as stopped or overdue is the server's rule for
 * that tab, read as the tab reads it, so the strip and the tab always agree.
 *
 * Not drawn while nothing needs attention, nor while the read is on its way:
 * a strip that appears only to say "nothing" is noise above every visit. A
 * failed read draws nothing either, since the Needs attention tab's own count
 * already says its read failed.
 *
 * @module components/features/releases/ReleaseAttentionStrip
 */
import type { JSX } from "react";

import { AlertTriangle } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useReleasesNeedingAttention } from "@admin/hooks/queries/useReleases";

import { releaseRowStatus } from "./release-list";
import { ReleaseStatusBadge } from "./ReleaseListCells";

/** How many releases the strip names: enough to act on, few enough to stay a strip. */
const STRIP_RELEASES = 3;

/** Where "View all" leads: the Releases list on its Needs attention tab. */
const ATTENTION_TAB_HREF = `${ROUTES.RELEASES}?tab=attention`;

const LINK_CLASS =
  "font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export interface ReleaseAttentionStripProps {
  /**
   * Called as "View all" is followed, so a page showing its calendar can turn
   * to the list, where the tab it leads to is drawn.
   */
  onShowAll?: () => void;
}

export function ReleaseAttentionStrip({
  onShowAll,
}: ReleaseAttentionStripProps): JSX.Element | null {
  const read = useReleasesNeedingAttention(STRIP_RELEASES);
  const total = read.data?.meta.total ?? 0;
  if (read.data === undefined || total === 0) return null;

  const rows = read.data.items;
  const more = total - rows.length;
  const heading =
    total === 1
      ? "1 release needs attention"
      : `${total} releases need attention`;

  return (
    // The border at full strength: faded, it fell below the 3:1 a boundary needs against the page.
    <section
      aria-labelledby="release-attention-strip"
      className="mb-6 rounded-md border border-danger-border bg-danger-surface px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2
          id="release-attention-strip"
          className="flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <AlertTriangle className="size-4 text-destructive" aria-hidden />
          {heading}
        </h2>
        <Link
          href={ATTENTION_TAB_HREF}
          onClick={onShowAll}
          className={`text-sm ${LINK_CLASS}`}
        >
          View all in Needs attention
        </Link>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {rows.map(release => (
          <li
            key={release.id}
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <ReleaseStatusBadge
              status={releaseRowStatus(release, "attention")}
            />
            <Link
              href={buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })}
              className={LINK_CLASS}
            >
              {release.title}
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">and {more} more</p>
      ) : null}
    </section>
  );
}
