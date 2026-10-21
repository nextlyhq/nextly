"use client";

/**
 * One day of the calendar, listed in full: what "+N more" opens, and what
 * Enter on a day opens.
 *
 * Read from the release list filtered to that day in the calendar's zone, so
 * it holds exactly the releases the day's count counted, paged like the list
 * rather than capped. Each release offers the list's own row menu, so an
 * action reads the same wherever the release is found.
 *
 * A sheet rather than a popover over the grid: a busy day is a list someone
 * reads and acts on, and it needs the height a popover does not have. Escape
 * closes it and returns focus to the day it was opened from.
 *
 * @module components/features/releases/ReleaseCalendarDaySheet
 */
import { useMemo, useState } from "react";

import { CalendarClock, Globe, X } from "@admin/components/icons";
import { SectionErrorFallback } from "@admin/components/shared/error-fallbacks";
import { Pagination } from "@admin/components/shared/pagination";
import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useReleaseListPage } from "@admin/hooks/queries/useReleases";
import type { Release } from "@admin/types/releases";

import {
  compareByPlacement,
  longDayLabel,
  releaseCalendarInstant,
  releaseCalendarStatus,
  type DayKey,
} from "./release-calendar";
import { zoneDisplayName } from "./release-calendar-zones";
import { releaseTimeOfDay, releaseTimeText } from "./release-time";
import { ReleaseStatusMark } from "./ReleaseListCells";
import {
  ReleaseRowDialogs,
  ReleaseRowMenuButton,
  type OpenDialog,
} from "./ReleaseRowMenu";
import { useClampedPage } from "./useClampedPage";

/** Releases per page of a day's list. */
const DAY_PAGE_SIZE = 20;

export function ReleaseCalendarDaySheet({
  day,
  zone,
  isToday,
  overdue,
  now,
  onClose,
  onReturnFocus,
}: {
  /** The day to list, or `null` while the sheet is closed. */
  day: DayKey | null;
  zone: string;
  isToday: boolean;
  /** The ids the server calls overdue, or `null` while not known. */
  overdue: ReadonlySet<string> | null;
  now: number;
  onClose: () => void;
  /**
   * Put focus back where the list was opened from. The sheet is opened
   * without a trigger of its own, so left to itself it would return focus to
   * nothing and a keyboard reader would start again from the top of the page.
   */
  onReturnFocus: () => void;
}) {
  return (
    <Sheet open={day !== null} onOpenChange={next => (next ? null : onClose())}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
        onCloseAutoFocus={event => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        {day ? (
          // Keyed by the day and zone, so its page starts at the first for
          // every day opened.
          <DayList
            key={`${day}|${zone}`}
            day={day}
            zone={zone}
            isToday={isToday}
            overdue={overdue}
            now={now}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DayList({
  day,
  zone,
  isToday,
  overdue,
  now,
}: {
  day: DayKey;
  zone: string;
  isToday: boolean;
  overdue: ReadonlySet<string> | null;
  now: number;
}) {
  const [page, setPage] = useState(0);
  const list = useReleaseListPage({
    day: { date: day, timezone: zone },
    page: page + 1,
    limit: DAY_PAGE_SIZE,
  });
  const total = list.data?.meta.total;
  // In the order of the times shown, as the grid draws them: the server
  // sends a page by scheduled time, and a release published late is shown at
  // the time it went out.
  const items = list.data?.items;
  const rows = useMemo(
    () => [...(items ?? [])].sort(compareByPlacement),
    [items]
  );
  // A day shrinks under the reader: publishing or moving the only release on
  // the last page leaves that page empty, with no pager to leave it by.
  useClampedPage(
    { page, pageSize: DAY_PAGE_SIZE, setPage },
    list.isPlaceholderData ? undefined : total
  );

  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const openDialog = (next: OpenDialog) => {
    setDialog(next);
    setDialogOpen(true);
  };

  return (
    <>
      <SheetHeader className="relative space-y-1 border-b border-border px-6 py-5 pr-14 text-left">
        <SheetClose asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            className="absolute right-3 top-3"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </SheetClose>
        <SheetTitle className="text-base">
          {longDayLabel(day)}
          {isToday ? (
            <span className="ml-2 align-middle text-xs font-medium text-primary">
              Today
            </span>
          ) : null}
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-1.5 text-sm">
          <span>{describeTotal(total)}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Globe className="size-3.5" aria-hidden />
            Times in {zoneDisplayName(zone)}
          </span>
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <DayListBody
          list={list}
          rows={rows}
          zone={zone}
          overdue={overdue}
          now={now}
          onOpen={openDialog}
        />
      </div>

      {total !== undefined && total > DAY_PAGE_SIZE ? (
        <div className="border-t border-border px-4 py-3">
          <Pagination
            currentPage={page}
            totalPages={Math.ceil(total / DAY_PAGE_SIZE)}
            totalItems={total}
            pageSize={DAY_PAGE_SIZE}
            showPageSizeSelector={false}
            maxVisiblePages={3}
            onPageChange={setPage}
            itemLabel={total === 1 ? "release" : "releases"}
            ariaLabel="Pages of this day's releases"
          />
        </div>
      ) : null}

      <ReleaseRowDialogs
        dialog={dialog}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}

/** "1 release", "12 releases", or a placeholder while the count loads. */
function describeTotal(total: number | undefined): string {
  if (total === undefined) return "Loading releases…";
  if (total === 0) return "No releases";
  return `${total} ${total === 1 ? "release" : "releases"}`;
}

function DayListBody({
  list,
  rows,
  zone,
  overdue,
  now,
  onOpen,
}: {
  list: ReturnType<typeof useReleaseListPage>;
  rows: Release[];
  zone: string;
  overdue: ReadonlySet<string> | null;
  now: number;
  onOpen: (dialog: OpenDialog) => void;
}) {
  if (list.isError) {
    return (
      <SectionErrorFallback
        title="This day's releases could not be loaded"
        description="This is a failed request, not an empty day. Try again in a moment."
        reset={() => void list.refetch()}
      />
    );
  }
  if (list.isPending) {
    return (
      <div className="flex flex-col gap-2 px-3 py-2" aria-busy="true">
        {[0, 1, 2].map(i => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <CalendarClock className="size-5 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          Nothing runs on this day.
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col" aria-label="Releases on this day">
      {rows.map(release => (
        <DayListRow
          key={release.id}
          release={release}
          zone={zone}
          overdue={overdue}
          now={now}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}

function DayListRow({
  release,
  zone,
  overdue,
  now,
  onOpen,
}: {
  release: Release;
  zone: string;
  overdue: ReadonlySet<string> | null;
  now: number;
  onOpen: (dialog: OpenDialog) => void;
}) {
  const instant = releaseCalendarInstant(release);
  // `null` while overdue is not known: the row then claims no state.
  const status = releaseCalendarStatus(release, overdue);
  // The scheduled zone belongs to a scheduled instant only: a published
  // release is shown at the moment it went out, which was scheduled nowhere.
  const scheduled =
    release.state === "published"
      ? null
      : (releaseTimeText(instant, {
          readerZone: zone,
          scheduledZone: release.timezone,
          now,
        })?.scheduled ?? null);
  return (
    <li className="flex items-start gap-3 rounded-md px-3 py-2.5 hover:bg-muted/60">
      <span className="w-[4.5rem] shrink-0 pt-0.5 text-sm tabular-nums text-muted-foreground">
        {releaseTimeOfDay(instant, zone) ?? "—"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })}
          className="truncate text-sm font-medium text-foreground hover:underline"
        >
          {release.title}
        </Link>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {status ? <ReleaseStatusMark status={status} /> : null}
          {scheduled ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Globe className="size-3 shrink-0" aria-hidden />
              {scheduled.text} {zoneDisplayName(scheduled.zone)} (as scheduled)
            </span>
          ) : null}
        </span>
      </span>
      <ReleaseRowMenuButton release={release} onOpen={onOpen} />
    </li>
  );
}
