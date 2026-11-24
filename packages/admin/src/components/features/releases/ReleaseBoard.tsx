"use client";

/**
 * The Releases Board: the list's four tabs as columns, side by side.
 *
 * Read-only on purpose. A release changes column by itself, when its moment
 * passes or its run stops, so dragging one between columns would add nothing
 * and could schedule or publish by accident. A tile opens the release, where
 * every action is offered with its checks.
 *
 * Each column reads its own tab through the list's read, a few releases with
 * the tab's true count, and leads to the rest in the List view, on that tab.
 *
 * @module components/features/releases/ReleaseBoard
 */

import { useMemo, type JSX } from "react";

import { Button, Skeleton } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useReleases } from "@admin/hooks/queries/useReleases";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import type { Release, ReleaseListTab } from "@admin/types/releases";

import {
  RELEASE_BOARD_COLUMNS,
  RELEASE_BOARD_LIMIT,
  releaseBoardMore,
  releaseBoardWhen,
} from "./release-board";
import {
  documentCount,
  releaseOwnerView,
  releaseRowStatus,
} from "./release-list";
import { readerZone } from "./release-timezone";
import { ReleaseStatusBadge } from "./ReleaseListCells";
import { useMinuteClock } from "./useMinuteClock";

export interface ReleaseBoardProps {
  /** Turns the page to the List view, on `tab`: where a column's rest is. */
  onShowTab: (tab: ReleaseListTab) => void;
}

export function ReleaseBoard({ onShowTab }: ReleaseBoardProps): JSX.Element {
  const zone = useMemo(() => readerZone(), []);
  const now = useMinuteClock();
  return (
    // Four columns where there is room, two on a tablet, one on a phone: each
    // column stands on its own, so a narrow screen stacks them in order.
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {RELEASE_BOARD_COLUMNS.map(column => (
        <BoardColumn
          key={column.tab}
          tab={column.tab}
          label={column.label}
          zone={zone}
          now={now}
          onShowTab={onShowTab}
        />
      ))}
    </div>
  );
}

function BoardColumn({
  tab,
  label,
  zone,
  now,
  onShowTab,
}: {
  tab: ReleaseListTab;
  label: string;
  zone: string;
  now: number;
  onShowTab: (tab: ReleaseListTab) => void;
}) {
  // The list's own read of this tab, polled on the list's speeds, so a
  // release moves column on the board when it moves tab in the list.
  const read = useReleases({ tab, limit: RELEASE_BOARD_LIMIT });
  const releases = read.data?.items ?? [];
  const total = read.data?.meta.total;
  const more =
    total === undefined ? 0 : releaseBoardMore(total, releases.length);
  return (
    <section
      aria-label={label}
      className="flex min-h-[12rem] flex-col gap-2 rounded-lg border border-border bg-card p-2.5"
    >
      <h2 className="flex items-center gap-1.5 px-1 pt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {total !== undefined ? (
          <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-foreground">
            {total}
          </span>
        ) : null}
      </h2>
      {read.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : read.isError && read.data === undefined ? (
        <div className="flex flex-col items-start gap-2 px-1 py-2">
          <p className="text-sm text-muted-foreground">
            These releases could not be loaded.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void read.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : releases.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">Nothing here</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {releases.map(release => (
            <li key={release.id}>
              <BoardTile release={release} tab={tab} zone={zone} now={now} />
            </li>
          ))}
        </ul>
      )}
      {more > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => onShowTab(tab)}
        >
          +{more} more
        </Button>
      ) : null}
    </section>
  );
}

/**
 * One release: its title, when it moves, its documents and its owner. Where
 * the column alone does not say how it stands (stopped or overdue, published
 * or cancelled), its status as the list draws it.
 */
function BoardTile({
  release,
  tab,
  zone,
  now,
}: {
  release: Release;
  tab: ReleaseListTab;
  zone: string;
  now: number;
}) {
  const { user: me } = useDashboardUser();
  const owner = releaseOwnerView({
    createdBy: release.createdBy,
    owner: release.owner,
    me,
  });
  const status = releaseRowStatus(release, tab);
  const showsStatus = tab === "attention" || tab === "done";
  const documents =
    release.memberCounts === undefined
      ? null
      : documentCount(release.memberCounts.total);
  return (
    <Link
      href={buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })}
      className="flex flex-col gap-1 rounded-md border border-border bg-background p-2.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="font-medium text-foreground">{release.title}</span>
      {showsStatus ? (
        <span className="self-start">
          <ReleaseStatusBadge status={status} />
        </span>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {releaseBoardWhen(release, tab, {
          readerZone: zone,
          scheduledZone: release.timezone,
          now,
        })}
      </span>
      <span className="text-xs text-muted-foreground">
        {[documents, owner.label].filter(Boolean).join(" · ")}
      </span>
    </Link>
  );
}
