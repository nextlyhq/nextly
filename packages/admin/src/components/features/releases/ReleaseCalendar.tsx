"use client";

/**
 * What ships when, on a month grid.
 *
 * A release list answers "what launches exist"; this answers "what is coming,
 * and is anything colliding" — the question somebody planning a week has.
 *
 * ## Truthful by construction
 *
 * The grid is drawn from the server's calendar read, never from a page of
 * releases bucketed here. The server places each release on its day in the
 * chosen zone (a published release on the day it went out) and counts every
 * day in full, so "+N more" is the day's complete count however busy the
 * month, and the day's full list, read from the list filtered to that day,
 * holds exactly what the count counted.
 *
 * ## The zone decides the day
 *
 * A release carries an instant, and which day that is has no answer until a
 * zone is named: 23:30 in New York is the next morning in London. The grid
 * starts in the reader's own zone, as the list reads times, and the zone
 * control above it offers the zones the releases on screen were scheduled
 * in, and any other. The chosen zone decides which day each release is on,
 * which day is today, and every count.
 *
 * ## Keyboard
 *
 * One tab stop for the grid, on the focused day. Arrows move by a day or a
 * week, Home and End to the week's ends, Page Up and Page Down by a month (by
 * a year with Shift). Enter or Space opens the day's full list. Tab moves on
 * to the focused day's own releases, and Enter on one opens it. Today is
 * announced as today.
 *
 * @module components/features/releases/ReleaseCalendar
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ChevronLeft, ChevronRight } from "@admin/components/icons";
import { SectionErrorFallback } from "@admin/components/shared/error-fallbacks";
import { Button, Skeleton } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import {
  useEveryReleaseId,
  useReleaseCalendar,
} from "@admin/hooks/queries/useReleases";
import { cn } from "@admin/lib/utils";
import type {
  Release,
  ReleaseCalendarDay,
  ReleaseCalendarRead,
} from "@admin/types/releases";

import {
  calendarDayLabel,
  calendarWindow,
  dayChips,
  longDayLabel,
  monthGrid,
  moveInCalendar,
  releaseCalendarInstant,
  releaseCalendarStatus,
  shiftDayByMonths,
  shiftMonth,
  type DayKey,
} from "./release-calendar";
import { zoneDisplayName } from "./release-calendar-zones";
import type { ReleaseRowStatus } from "./release-list";
import { releaseTimeOfDay } from "./release-time";
import { dayKeyIn, readerZone } from "./release-timezone";
import { ReleaseCalendarDaySheet } from "./ReleaseCalendarDaySheet";
import { ReleaseCalendarZoneControl } from "./ReleaseCalendarZoneControl";
import { RELEASE_STATUS_TONE, ReleaseStatusMark } from "./ReleaseListCells";
import { useMinuteClock } from "./useMinuteClock";

/** The grid's columns, Monday first, as `monthGrid` lays the days out. */
const WEEKDAYS = [
  { short: "Mon", long: "Monday" },
  { short: "Tue", long: "Tuesday" },
  { short: "Wed", long: "Wednesday" },
  { short: "Thu", long: "Thursday" },
  { short: "Fri", long: "Friday" },
  { short: "Sat", long: "Saturday" },
  { short: "Sun", long: "Sunday" },
];

/**
 * How far an instant window must reach either side of a grid's dates to hold
 * every instant of those days in any zone: UTC−12 to UTC+14.
 */
const WIDEST_OFFSET_MS = 14 * 3_600_000;
const DAY_MS = 86_400_000;

/** `October 2026`, in the reader's locale. */
function monthLabel(month: string): string {
  return new Date(`${month}-15T12:00:00.000Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** No release is overdue. */
const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * The ids of the releases the server calls overdue, among those the grid
 * can show.
 *
 * Asked of the server's own Needs attention read, narrowed to an instant
 * window that holds every day of the grid in any zone, rather than worked out
 * from this browser's clock: the list and the calendar then cannot disagree
 * about a release near the cutoff. Not asked at all for a grid wholly in the
 * future, where nothing can be overdue.
 */
function useOverdueIds(days: { from: DayKey; to: DayKey }, now: number) {
  const after = Date.parse(`${days.from}T00:00:00.000Z`) - WIDEST_OFFSET_MS;
  const before =
    Date.parse(`${days.to}T00:00:00.000Z`) + DAY_MS + WIDEST_OFFSET_MS;
  // Read in full, page by page: a window holding more overdue releases than
  // one page would otherwise call the rest "Scheduled".
  const read = useEveryReleaseId(
    {
      tab: "attention",
      reason: "overdue",
      scheduledAfter: new Date(after).toISOString(),
      scheduledBefore: new Date(before).toISOString(),
    },
    after < now
  );
  const ids = read.data;
  const known = useMemo(() => (ids ? new Set(ids) : null), [ids]);
  // Not asked at all for a grid wholly in the future: nothing there can be
  // overdue, which is a known answer, not a missing one.
  const asked = after < now;
  return {
    /** The overdue ids, or `null` while the answer is on its way or failed. */
    ids: asked ? known : EMPTY_IDS,
    failed: asked && read.isError,
    retry: () => void read.refetch(),
  };
}

/**
 * Which day's list is open, and where focus goes back to when it closes: the
 * day itself, or its "+N more", whichever opened it.
 */
function useDayListOpener() {
  const [day, setDay] = useState<DayKey | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  return {
    day,
    open: (next: DayKey) => {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setDay(next);
    },
    close: () => setDay(null),
    /** Back to the opener, or to the focused day if it has gone. */
    returnFocus: (focused: DayKey) => {
      const back = opener.current;
      if (back?.isConnected) {
        back.focus();
        return;
      }
      document.querySelector<HTMLElement>(`[data-day="${focused}"]`)?.focus();
    },
  };
}

/** The calendar answer's days by date, and the zones its releases name. */
function useCalendarDays(data: ReleaseCalendarRead | undefined) {
  return useMemo(() => {
    const days = data?.days ?? [];
    return {
      byDate: new Map(days.map(day => [day.date, day])),
      scheduledZones: days.flatMap(day =>
        day.releases.flatMap(release =>
          release.timezone ? [release.timezone] : []
        )
      ),
    };
  }, [data]);
}

/**
 * Today, the month arrows and the month's name, with the zone control at the
 * other end.
 */
function CalendarToolbar({
  month,
  headingId,
  onToday,
  onPage,
  children,
}: {
  month: string;
  headingId: string;
  onToday: () => void;
  onPage: (offset: number) => void;
  /** The zone control. */
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onToday}>
          Today
        </Button>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => onPage(-1)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => onPage(1)}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
        {/* Announced when it changes, so paging by keyboard says where it
              arrived. */}
        <h2
          id={headingId}
          aria-live="polite"
          className="text-base font-semibold tracking-tight text-foreground"
        >
          {monthLabel(month)}
        </h2>
      </div>
      {children}
    </div>
  );
}

/**
 * What could not be read, each said as a failure with a retry, never as an
 * empty month or as releases that are on time.
 */
function CalendarReadFailures({
  calendar,
  overdue,
}: {
  calendar: { failed: boolean; retry: () => void };
  overdue: { failed: boolean; retry: () => void };
}) {
  return (
    <>
      {calendar.failed ? (
        <SectionErrorFallback
          title="This month's releases could not be loaded"
          description="This is a failed request, not an empty month. Try again in a moment."
          reset={calendar.retry}
        />
      ) : null}
      {overdue.failed ? (
        <SectionErrorFallback
          title="Overdue releases could not be checked"
          description="Scheduled releases show their time but not whether they are overdue until this loads. Try again in a moment."
          reset={overdue.retry}
        />
      ) : null}
    </>
  );
}

export function ReleaseCalendar() {
  const reader = useMemo(() => readerZone(), []);
  const [zone, setZone] = useState(reader);
  const now = useMinuteClock();
  // Read on every render rather than memoised: a page left open across
  // midnight must move today to the new day, and the minute clock is what
  // re-renders it.
  const today = dayKeyIn(new Date(now), zone);

  // The month shown, and the day that holds the grid's one tab stop. Kept
  // apart so a click on a leading or trailing day opens it without paging
  // the grid away under the pointer; a key that moves past the month's edge
  // pages, as the date grid pattern does.
  const [view, setView] = useState(() => ({
    month: today.slice(0, 7),
    focused: today,
  }));
  const { month, focused } = view;
  const dayList = useDayListOpener();

  const gridDays = useMemo(() => calendarWindow(month), [month]);
  const calendar = useReleaseCalendar({ ...gridDays, timezone: zone });
  const overdueRead = useOverdueIds(gridDays, now);
  const overdue = overdueRead.ids;

  /** Show `day`'s month, focused on `day`. */
  const goTo = (day: DayKey) =>
    setView({ month: day.slice(0, 7), focused: day });
  /** Page by `offset` months, keeping the focused date where it exists. */
  const pageBy = (offset: number) =>
    goTo(
      shiftDayByMonths(
        `${shiftMonth(month, offset)}-${focused.slice(8, 10)}`,
        0
      )
    );

  const { byDate, scheduledZones } = useCalendarDays(calendar.data);

  const changeZone = (next: string) => {
    // Today is a day in a zone. A reader looking at today keeps looking at
    // today when the zone moves it.
    if (focused === today) goTo(dayKeyIn(new Date(now), next));
    setZone(next);
  };

  const headingId = useId();
  const noteId = useId();

  return (
    <div className="flex flex-col gap-4">
      <CalendarToolbar
        month={month}
        headingId={headingId}
        onToday={() => goTo(today)}
        onPage={pageBy}
      >
        <ReleaseCalendarZoneControl
          zone={zone}
          readerZone={reader}
          scheduledZones={scheduledZones}
          at={new Date(`${month}-15T12:00:00.000Z`)}
          onChange={changeZone}
        />
      </CalendarToolbar>

      <CalendarReadFailures
        calendar={{
          failed: calendar.isError,
          retry: () => void calendar.refetch(),
        }}
        overdue={{ failed: overdueRead.failed, retry: overdueRead.retry }}
      />

      {/* With no answer to draw, no grid: every day would otherwise say "no
          releases" about a month that was never read, under an error saying
          it is not empty. A failed refresh keeps the answer it had, and the
          grid with it. */}
      {calendar.isError && calendar.data === undefined ? null : (
        <MonthGrid
          month={month}
          today={today}
          focused={focused}
          byDate={byDate}
          overdue={overdue}
          zone={zone}
          isPending={calendar.isPending}
          labelledBy={headingId}
          describedBy={noteId}
          onFocusDay={day => setView(current => ({ ...current, focused: day }))}
          onMoveDay={goTo}
          onOpenDay={dayList.open}
        />
      )}

      <p id={noteId} className="text-xs text-muted-foreground">
        Days and times are in {zoneDisplayName(zone)}
        {zone === reader ? " (your time zone)" : ""}. A published release is on
        the day it went out. Drafts have no date yet, so they are not on the
        calendar: they are in the list&rsquo;s Drafts tab.
      </p>

      <ReleaseCalendarDaySheet
        day={dayList.day}
        zone={zone}
        isToday={dayList.day === today}
        overdue={overdue}
        now={now}
        onClose={dayList.close}
        onReturnFocus={() => dayList.returnFocus(focused)}
      />
    </div>
  );
}

/**
 * The month as a keyboard grid: one tab stop, on the focused day.
 *
 * A table with the grid role, as the WAI-ARIA date grid is, so a screen
 * reader announces the weekday column with each day.
 */
function MonthGrid({
  month,
  today,
  focused,
  byDate,
  overdue,
  zone,
  isPending,
  labelledBy,
  describedBy,
  onFocusDay,
  onMoveDay,
  onOpenDay,
}: {
  month: string;
  today: DayKey;
  focused: DayKey;
  byDate: Map<string, ReleaseCalendarDay>;
  /** The ids the server calls overdue, or `null` while not known. */
  overdue: ReadonlySet<string> | null;
  zone: string;
  isPending: boolean;
  labelledBy: string;
  describedBy: string;
  /** The reader focused a day already on the grid. */
  onFocusDay: (day: DayKey) => void;
  /** A key moved the focus to a day, which may be in another month. */
  onMoveDay: (day: DayKey) => void;
  onOpenDay: (day: DayKey) => void;
}) {
  const grid = useMemo(() => monthGrid(month), [month]);
  const tableRef = useRef<HTMLTableElement>(null);
  // Set by a key press, so focus follows the focused day only when the
  // reader moved it from the grid; a Today or month button keeps its own
  // focus.
  const keyMoved = useRef(false);

  useEffect(() => {
    if (!keyMoved.current) return;
    keyMoved.current = false;
    tableRef.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)
      ?.focus();
  }, [focused]);

  const onKeyDown = (event: React.KeyboardEvent, day: DayKey) => {
    const next = moveInCalendar(day, event);
    if (next === null) return;
    event.preventDefault();
    keyMoved.current = true;
    onMoveDay(next);
  };

  return (
    <table
      ref={tableRef}
      role="grid"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-busy={isPending || undefined}
      className="w-full table-fixed border-collapse overflow-hidden rounded-lg"
    >
      <thead>
        <tr>
          {WEEKDAYS.map(weekday => (
            <th
              key={weekday.short}
              scope="col"
              abbr={weekday.long}
              className="border border-border bg-muted/40 py-2 text-center text-xs font-medium text-muted-foreground"
            >
              <span className="sm:hidden" aria-hidden>
                {weekday.short.charAt(0)}
              </span>
              <span className="sr-only sm:not-sr-only">{weekday.short}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.weeks.map(week => (
          <tr key={week[0]}>
            {week.map(day => (
              <DayCell
                key={day}
                day={day}
                inMonth={day.startsWith(month)}
                isToday={day === today}
                isFocused={day === focused}
                data={byDate.get(day)}
                overdue={overdue}
                zone={zone}
                isPending={isPending}
                onKeyDown={event => onKeyDown(event, day)}
                onFocus={() => onFocusDay(day)}
                onOpen={() => onOpenDay(day)}
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A day with nothing on it, for a cell whose answer has not arrived. */
function emptyDay(date: DayKey): ReleaseCalendarDay {
  return {
    date,
    total: 0,
    counts: { draft: 0, scheduled: 0, published: 0, cancelled: 0, blocked: 0 },
    releases: [],
  };
}

/** What one day cell is handed. */
interface DayCellProps {
  day: DayKey;
  inMonth: boolean;
  isToday: boolean;
  isFocused: boolean;
  data: ReleaseCalendarDay | undefined;
  /** The ids the server calls overdue, or `null` while not known. */
  overdue: ReadonlySet<string> | null;
  zone: string;
  isPending: boolean;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onFocus: () => void;
  onOpen: () => void;
}

function DayCell(props: DayCellProps) {
  const { day, inMonth, isToday, isFocused, data, isPending } = props;
  // Not yet answered is not the same as empty: the cell says neither "no
  // releases" nor a count until the read for its window arrives.
  const loading = isPending && data === undefined;
  const known = data ?? emptyDay(day);
  // Only the focused day's own releases are tab stops, so Tab from the grid
  // reaches them and not every release of the month.
  const tabIndex = isFocused ? 0 : -1;

  return (
    <td
      role="gridcell"
      className={cn(
        "relative h-14 border border-border p-0 align-top sm:h-[9.5rem]",
        // Today is marked by its filled date alone: a tinted cell reads
        // like the neighbouring months' muted days.
        inMonth ? "bg-background" : "bg-muted/40"
      )}
    >
      <DayButton
        {...props}
        label={
          loading
            ? `${longDayLabel(day)}${isToday ? ", today" : ""}`
            : calendarDayLabel(known, { isToday })
        }
        tabIndex={tabIndex}
      />
      <div className="pointer-events-none relative z-10 flex flex-col gap-1 px-1 pb-1 pt-8 sm:px-1.5 sm:pb-1.5">
        {loading ? (
          inMonth ? (
            <Skeleton className="hidden h-8 w-full sm:block" />
          ) : null
        ) : (
          <DayReleases {...props} known={known} tabIndex={tabIndex} />
        )}
      </div>
    </td>
  );
}

/**
 * The day's own button, the whole cell, so a click or tap anywhere in it
 * opens the day. The releases sit above it in their own layer.
 */
function DayButton({
  day,
  inMonth,
  isToday,
  label,
  tabIndex,
  onKeyDown,
  onFocus,
  onOpen,
}: DayCellProps & { label: string; tabIndex: number }) {
  return (
    <button
      type="button"
      data-day={day}
      tabIndex={tabIndex}
      aria-label={label}
      aria-current={isToday ? "date" : undefined}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onClick={onOpen}
      className="absolute inset-0 flex items-start justify-center p-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:justify-start"
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
          isToday && "bg-primary font-semibold text-primary-foreground",
          !isToday && inMonth && "font-medium text-foreground",
          !isToday && !inMonth && "text-muted-foreground"
        )}
      >
        {Number(day.slice(8, 10))}
      </span>
    </button>
  );
}

/** A day's chips, its "+N more", and its count on a narrow screen. */
function DayReleases({
  day,
  known,
  overdue,
  zone,
  tabIndex,
  onOpen,
}: DayCellProps & { known: ReleaseCalendarDay; tabIndex: number }) {
  const { shown, more } = dayChips(known);
  return (
    <>
      <ul className="hidden flex-col gap-1 sm:flex">
        {shown.map(release => (
          <li key={release.id}>
            <ReleaseChip
              release={release}
              status={releaseCalendarStatus(release, overdue)}
              zone={zone}
              tabIndex={tabIndex}
            />
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <button
          type="button"
          tabIndex={tabIndex}
          onClick={onOpen}
          aria-label={`+${more} more releases on ${longDayLabel(day)}`}
          className="pointer-events-auto hidden self-start rounded px-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block"
        >
          +{more} more
        </button>
      ) : null}
      <CompactCount day={known} />
    </>
  );
}

/**
 * A day's count on a narrow screen, where seven columns leave no room for a
 * chip. The day's own button already says it, so this is not announced.
 */
function CompactCount({ day }: { day: ReleaseCalendarDay }) {
  if (day.total === 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "mx-auto inline-flex min-w-5 justify-center rounded-full px-1 text-[11px] font-medium leading-4 tabular-nums sm:hidden",
        day.counts.blocked > 0
          ? "bg-destructive/10 text-destructive"
          : "bg-primary/10 text-primary"
      )}
    >
      {day.total}
    </span>
  );
}

/**
 * One release on its day: its title, then its time and its state, as an icon
 * and a word. A link to the release, so Enter on it opens it.
 */
function ReleaseChip({
  release,
  status,
  zone,
  tabIndex,
}: {
  release: Release;
  /** `null` while the release's state is not known. */
  status: ReleaseRowStatus | null;
  zone: string;
  tabIndex: number;
}) {
  const time = releaseTimeOfDay(releaseCalendarInstant(release), zone);
  return (
    <Link
      href={buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })}
      tabIndex={tabIndex}
      className="pointer-events-auto relative flex flex-col gap-0.5 overflow-hidden rounded-md border border-border bg-card py-1 pl-2.5 pr-1.5 text-left shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          status ? RELEASE_STATUS_TONE[status].bar : "bg-border"
        )}
      />
      <span
        className={cn(
          "truncate text-xs font-medium",
          status === "cancelled" ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {release.title}
      </span>{" "}
      {/* The spaces between the parts are for the link's name: without them
          a screen reader reads the title, time and state as one word. */}
      {status ? (
        <ReleaseStatusMark status={status} className="text-[11px] leading-4">
          {time ? <span className="shrink-0 tabular-nums">{time}</span> : null}{" "}
          <span aria-hidden>·</span>
        </ReleaseStatusMark>
      ) : (
        // The time alone while the state is not known: nothing is claimed.
        <span className="text-[11px] leading-4 tabular-nums text-muted-foreground">
          {time}
        </span>
      )}
    </Link>
  );
}
