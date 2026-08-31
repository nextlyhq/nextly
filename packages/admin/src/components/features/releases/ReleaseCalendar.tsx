"use client";

/**
 * What ships when, on a month grid.
 *
 * A release list answers "what launches exist"; this answers "what is coming,
 * and is anything colliding" — the question somebody planning a week actually
 * has, and one a list ordered by instant answers only by being read end to end.
 *
 * ## Why the zone is a control rather than an assumption
 *
 * A release carries an instant AND the author's timezone, so "which day does
 * this land on" has no answer until a zone is named: 23:00 in New York is the
 * following day in UTC. Every product that ships this surface makes the zone
 * explicit — Sanity puts a timezone picker on its release calendar and
 * remembers the choice, Storyblok spans markets and zones — because a team
 * coordinating a launch is rarely all in one place, and a grid that silently
 * used the viewer's zone would show two colleagues different days for one
 * launch with nothing on screen to explain it.
 *
 * The default is the reader's own zone, which is right far more often than UTC.
 * The choice persists, because it is a property of the person rather than of
 * the visit.
 *
 * ## Why cells carry counts rather than content
 *
 * A month grid goes noisy the moment state is rendered into it, and the cells
 * are narrow at any width. So a day shows how much is happening and whether any
 * of it needs attention; selecting it lists the releases underneath at full
 * width, where their titles are readable and their actions reachable.
 *
 * @module components/features/releases/ReleaseCalendar
 */
import { useMemo, useState } from "react";

import { ChevronLeft, ChevronRight } from "@admin/components/icons";
import { Badge, Button, Card } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useReleases } from "@admin/hooks/queries/useReleases";
import { isValidTimezone } from "@admin/lib/dates/format";
import type { Release } from "@admin/types/releases";

import {
  bucketByDay,
  monthGrid,
  monthOf,
  monthWindow,
  shiftMonth,
  type CalendarMonth,
  type DayKey,
} from "./release-calendar";
import { RELEASE_STATE_LABEL } from "./release-schedule";
import { readerZone } from "./release-timezone";

/** Where the reader's chosen zone is remembered between visits. */
const ZONE_KEY = "nextly.releases.calendar.zone";

/**
 * How many releases one month may return before the answer is incomplete.
 *
 * The route's own ceiling. A month holding more than this is implausible for a
 * publishing schedule, which is why this is a REPORTED limit rather than a
 * paging loop: the honest thing at that volume is to say the grid is partial,
 * not to issue five more requests to fill in a view nobody can read anyway.
 */
const CALENDAR_PAGE_LIMIT = 200;

/**
 * The zone to draw in: what the reader last chose, else their own.
 *
 * Storage is read defensively and never trusted to be readable — a private
 * window, cleared site data or a browser refusing storage all throw, and a
 * calendar that fails to render because it could not remember a preference
 * would be worse than one that quietly falls back.
 */
function initialZone(): string {
  try {
    const stored = window.localStorage.getItem(ZONE_KEY);
    if (stored && isValidTimezone(stored)) return stored;
  } catch {
    // Falls through to the reader's own zone.
  }
  return readerZone();
}

function rememberZone(zone: string): void {
  try {
    window.localStorage.setItem(ZONE_KEY, zone);
  } catch {
    // A preference that cannot be stored is not worth failing a render over.
  }
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Every zone this reader can choose between.
 *
 * The platform's own list where it has one, because a short hand-picked set
 * cannot serve a distributed team: somebody in Los Angeles comparing a launch
 * an Asia/Riyadh colleague scheduled needs that zone, and a curated nine will
 * never contain the one a given pair happens to need.
 *
 * `Intl.supportedValuesOf` is not on every runtime, so the zones the FETCHED
 * releases were authored in are always offered — those are the ones this page
 * has an actual reason to show — along with the reader's own and whatever is
 * currently selected, which might have come from storage.
 */
function zoneChoices(current: string, authored: readonly string[]): string[] {
  const supported = supportedZones();
  const always = [readerZone(), current, "UTC", ...authored];
  return [...new Set([...always, ...supported])].filter(isValidTimezone);
}

function supportedZones(): string[] {
  try {
    const of = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    return typeof of === "function" ? of("timeZone") : [];
  } catch {
    return [];
  }
}

export function ReleaseCalendar() {
  const [zone, setZone] = useState(initialZone);
  const [month, setMonth] = useState(() => monthOf(new Date(), zone));
  const [selected, setSelected] = useState<DayKey | null>(null);

  const window_ = useMemo(() => monthWindow(month, zone), [month, zone]);
  // The month IS the query. The list route already takes an instant window, so
  // a calendar needs no endpoint of its own — and asking for one month rather
  // than everything is also what keeps this clear of the list's page ceiling.
  const { data, isPending, isError } = useReleases({
    scheduledAfter: window_.after,
    scheduledBefore: window_.before,
    limit: CALENDAR_PAGE_LIMIT,
  });

  const releases = useMemo(() => data?.items ?? [], [data]);
  // The route answers this when the window held more than it returned. Reported
  // rather than absorbed: the list is ordered by instant DESCENDING, so a
  // truncated month drops the EARLIEST days — the grid would look empty exactly
  // where the reader is most likely to be looking, and nothing on screen would
  // say the month was not fully read.
  const truncated = data?.meta.hasNext ?? false;
  const authoredZones = useMemo(
    () =>
      releases
        .map(release => release.timezone)
        .filter((zone): zone is string => Boolean(zone)),
    [releases]
  );
  const byDay = useMemo(() => bucketByDay(releases, zone), [releases, zone]);
  const grid = useMemo(() => monthGrid(month), [month]);
  const today = useMemo(() => monthOf(new Date(), zone), [zone]);

  // A selected day belongs to the month it was chosen in. Paging without
  // clearing leaves the panel open on a date the new grid does not contain,
  // where it reports "nothing is scheduled" about a day that is not on screen.
  const goToMonth = (next: string) => {
    setMonth(next);
    setSelected(null);
  };

  const changeZone = (next: string) => {
    setZone(next);
    rememberZone(next);
    // The selection is a DAY IN A ZONE, and it stops meaning the same thing
    // when the zone changes. Cleared rather than carried, because a day panel
    // labelled with one zone and filled from another is the exact confusion
    // this control exists to remove.
    setSelected(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <CalendarToolbar
        month={month}
        today={today}
        zone={zone}
        zones={zoneChoices(zone, authoredZones)}
        onMonth={goToMonth}
        onZone={changeZone}
      />

      <CalendarBody
        month={month}
        zone={zone}
        grid={grid}
        byDay={byDay}
        selected={selected}
        onSelect={setSelected}
        isPending={isPending}
        isError={isError}
        truncated={truncated}
      />
    </div>
  );
}

/**
 * Everything that depends on the ANSWER: the grid, the day panel, the agenda.
 *
 * Split from the component above so that one holds the query and this one holds
 * the rendering, rather than a single function nesting a failure branch, a
 * truncation branch and two device branches inside each other.
 */
function CalendarBody({
  month,
  zone,
  grid,
  byDay,
  selected,
  onSelect,
  isPending,
  isError,
  truncated,
}: {
  month: string;
  zone: string;
  grid: CalendarMonth;
  byDay: Map<DayKey, Release[]>;
  selected: DayKey | null;
  onSelect: (day: DayKey | null) => void;
  isPending: boolean;
  isError: boolean;
  truncated: boolean;
}) {
  if (isError) {
    return (
      <Card className="px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          This month&rsquo;s schedule could not be loaded.
        </p>
      </Card>
    );
  }

  return (
    <>
      {/* The grid is hidden on narrow screens rather than squeezed: seven
              columns at phone width leaves each day too small to carry a count,
              let alone be tapped. The agenda below is the same month, read as a
              sequence. */}
      {/* Deliberately NOT `role="grid"`. Declaring one promises composite
              keyboard behaviour — a single tab stop with arrow-key movement —
              and a grid that announces itself without providing it is worse
              than plain controls: a keyboard user is told to expect arrows,
              presses them, and nothing happens. These are ordinary buttons in a
              labelled group, which is what they behave like. */}
      <div
        className="hidden grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid"
        role="group"
        aria-label={`Releases in ${monthLabel(month)}, times in ${zone}`}
      >
        {WEEKDAYS.map(day => (
          <div
            key={day}
            aria-hidden
            className="bg-muted px-2 py-1.5 text-center text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
        {grid.weeks.flat().map((day: DayKey) => (
          <DayCell
            key={day}
            day={day}
            month={month}
            releases={byDay.get(day) ?? []}
            isSelected={selected === day}
            isPending={isPending}
            onSelect={() => onSelect(selected === day ? null : day)}
          />
        ))}
      </div>

      {truncated ? (
        <p role="status" className="text-sm text-muted-foreground">
          This month holds more than {CALENDAR_PAGE_LIMIT} releases, so the grid
          is showing the latest {CALENDAR_PAGE_LIMIT} and earlier days may look
          emptier than they are. Narrow the range from the list view to see
          them.
        </p>
      ) : null}

      <DayDetail
        day={selected}
        zone={zone}
        releases={selected ? (byDay.get(selected) ?? []) : []}
      />

      <Agenda
        byDay={byDay}
        grid={grid}
        month={month}
        zone={zone}
        isPending={isPending}
      />
    </>
  );
}

/** `September 2026`, in the reader's locale. */
function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * What a day cell says out loud, which is the whole cell for a screen reader.
 *
 * Built as a sentence rather than assembled inline so the spoken version and
 * the badge cannot drift: a cell that shows a count and announces nothing is
 * the ordinary way this control becomes unusable without looking broken.
 */
function dayCellLabel(day: DayKey, count: number, stopped: number): string {
  if (count === 0) return `${day}, nothing scheduled`;
  const plural = count === 1 ? "release" : "releases";
  // COUNTED, not a boolean. Two stopped releases on one day announced as "one
  // stopped" is a false collision summary to the reader who cannot see the
  // badge, and the number is already in hand.
  const tail = stopped === 0 ? "" : `, ${stopped} stopped`;
  return `${day}, ${count} ${plural}${tail}`;
}

/** The count, and how much of it needs somebody. */
function DayCount({ count, stopped }: { count: number; stopped: number }) {
  if (count === 0) return null;
  return (
    <Badge variant={stopped > 0 ? "destructive" : "warning"}>
      {stopped > 0 ? `${count} · ${stopped} stopped` : count}
    </Badge>
  );
}

function DayCell({
  day,
  month,
  releases,
  isSelected,
  isPending,
  onSelect,
}: {
  day: DayKey;
  month: string;
  releases: Release[];
  isSelected: boolean;
  isPending: boolean;
  onSelect: () => void;
}) {
  const inMonth = day.startsWith(month);
  const stopped = releases.filter(
    release => release.state === "blocked"
  ).length;
  const count = releases.length;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      aria-label={dayCellLabel(day, count, stopped)}
      className={cellClassName({ inMonth, isSelected })}
    >
      <span
        className={
          inMonth ? "text-xs text-foreground" : "text-xs text-muted-foreground"
        }
      >
        {Number(day.slice(8, 10))}
      </span>
      {isPending ? null : <DayCount count={count} stopped={stopped} />}
    </button>
  );
}

/** The cell's own styling, kept out of the render so the markup stays legible. */
function cellClassName({
  inMonth,
  isSelected,
}: {
  inMonth: boolean;
  isSelected: boolean;
}): string {
  return [
    "flex min-h-[5rem] flex-col items-start gap-1 p-2 text-left transition-colors",
    inMonth ? "bg-background" : "bg-muted/40",
    isSelected ? "ring-2 ring-inset ring-primary" : "hover:bg-accent",
  ].join(" ");
}

function DayDetail({
  day,
  zone,
  releases,
}: {
  day: DayKey | null;
  zone: string;
  releases: Release[];
}) {
  if (!day) return null;
  return (
    <Card className="flex flex-col gap-2 px-4 py-3">
      <h2 className="text-sm font-medium text-foreground">
        {new Date(`${day}T12:00:00.000Z`).toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })}
      </h2>
      {releases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing is scheduled for this day.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {releases.map(release => (
            <ReleaseRow key={release.id} release={release} zone={zone} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The month as a sequence, for narrow screens and for reading straight through.
 *
 * Not a fallback bolted on: a month grid answers "is anything colliding" and an
 * agenda answers "what happens next", and somebody on a phone is far more often
 * asking the second.
 */
function Agenda({
  byDay,
  grid,
  month,
  zone,
  isPending,
}: {
  byDay: Map<DayKey, Release[]>;
  grid: { weeks: DayKey[][] };
  month: string;
  zone: string;
  isPending: boolean;
}) {
  const days = grid.weeks
    .flat()
    .filter(day => day.startsWith(month))
    .filter(day => (byDay.get(day)?.length ?? 0) > 0);

  // NOT YET ASKED is not the same as nothing scheduled, and on a narrow screen
  // this is the only view — so an unanswered query would otherwise render a
  // confident "nothing scheduled this month" before the request returns, which
  // is the answer a reader is most likely to act on and leave.
  if (isPending) {
    return (
      <p
        role="status"
        className="px-1 py-6 text-sm text-muted-foreground sm:hidden"
      >
        Loading this month&rsquo;s schedule&hellip;
      </p>
    );
  }

  if (days.length === 0) {
    return (
      <Card className="px-6 py-10 text-center sm:hidden">
        <p className="text-sm text-muted-foreground">
          Nothing is scheduled this month.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:hidden">
      {days.map(day => (
        <Card key={day} className="flex flex-col gap-2 px-4 py-3">
          <h3 className="text-sm font-medium text-foreground">
            {new Date(`${day}T12:00:00.000Z`).toLocaleDateString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            })}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {(byDay.get(day) ?? []).map(release => (
              <ReleaseRow key={release.id} release={release} zone={zone} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function ReleaseRow({ release, zone }: { release: Release; zone: string }) {
  const at = release.scheduledAt ? new Date(release.scheduledAt) : null;
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="tabular-nums text-muted-foreground">
        {at
          ? at.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: zone,
            })
          : "—"}
      </span>
      <Link
        href={buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })}
        className="font-medium text-foreground underline"
      >
        {release.title}
      </Link>
      {release.state === "scheduled" ? null : (
        <Badge
          variant={release.state === "blocked" ? "destructive" : "outline"}
        >
          {RELEASE_STATE_LABEL[release.state]}
        </Badge>
      )}
    </li>
  );
}

/**
 * Month navigation and the zone the grid is drawn in.
 *
 * Split out because it is the one part of this screen with no dependency on the
 * releases themselves — it decides WHICH releases to ask for, and knows nothing
 * about the answer.
 */
function CalendarToolbar({
  month,
  today,
  zone,
  zones,
  onMonth,
  onZone,
}: {
  month: string;
  today: string;
  zone: string;
  zones: string[];
  onMonth: (month: string) => void;
  onZone: (zone: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Previous month"
          onClick={() => onMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <span className="min-w-[9rem] text-center text-sm font-medium">
          {monthLabel(month)}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label="Next month"
          onClick={() => onMonth(shiftMonth(month, 1))}
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
        {month === today ? null : (
          <Button variant="ghost" size="sm" onClick={() => onMonth(today)}>
            Today
          </Button>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {/* NAMED on screen, not just applied. Two colleagues comparing this
            page need to be able to see they are reading the same grid. */}
        <span>Times shown in</span>
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          value={zone}
          onChange={event => onZone(event.target.value)}
        >
          {zones.map(choice => (
            <option key={choice} value={choice}>
              {choice.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
