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
  type DayKey,
} from "./release-calendar";
import { RELEASE_STATE_LABEL } from "./release-schedule";
import { readerZone } from "./release-timezone";

/** Where the reader's chosen zone is remembered between visits. */
const ZONE_KEY = "nextly.releases.calendar.zone";

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

/** The zones offered, with the reader's own first however it is spelled. */
function zoneChoices(current: string): string[] {
  const common = [
    "UTC",
    "America/Los_Angeles",
    "America/New_York",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Tokyo",
    "Australia/Sydney",
  ];
  return [...new Set([readerZone(), current, ...common])].filter(
    isValidTimezone
  );
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
    limit: 200,
  });

  const releases = useMemo(() => data?.items ?? [], [data]);
  const byDay = useMemo(() => bucketByDay(releases, zone), [releases, zone]);
  const grid = useMemo(() => monthGrid(month), [month]);
  const today = useMemo(() => monthOf(new Date(), zone), [zone]);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="Previous month"
            onClick={() => setMonth(shiftMonth(month, -1))}
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
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
          {month === today ? null : (
            <Button variant="ghost" size="sm" onClick={() => setMonth(today)}>
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
            onChange={event => changeZone(event.target.value)}
          >
            {zoneChoices(zone).map(choice => (
              <option key={choice} value={choice}>
                {choice.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isError ? (
        <Card className="px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            This month&rsquo;s schedule could not be loaded.
          </p>
        </Card>
      ) : (
        <>
          {/* The grid is hidden on narrow screens rather than squeezed: seven
              columns at phone width leaves each day too small to carry a count,
              let alone be tapped. The agenda below is the same month, read as a
              sequence. */}
          <div
            className="hidden grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid"
            role="grid"
            aria-label={`Releases in ${monthLabel(month)}, times in ${zone}`}
          >
            {WEEKDAYS.map(day => (
              <div
                key={day}
                role="columnheader"
                className="bg-muted px-2 py-1.5 text-center text-xs font-medium text-muted-foreground"
              >
                {day}
              </div>
            ))}
            {grid.weeks.flat().map(day => (
              <DayCell
                key={day}
                day={day}
                month={month}
                releases={byDay.get(day) ?? []}
                isSelected={selected === day}
                isPending={isPending}
                onSelect={() => setSelected(selected === day ? null : day)}
              />
            ))}
          </div>

          <DayDetail
            day={selected}
            zone={zone}
            releases={selected ? (byDay.get(selected) ?? []) : []}
          />

          <Agenda byDay={byDay} grid={grid} month={month} zone={zone} />
        </>
      )}
    </div>
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
function dayCellLabel(day: DayKey, count: number, stopped: boolean): string {
  if (count === 0) return `${day}, nothing scheduled`;
  const plural = count === 1 ? "release" : "releases";
  const tail = stopped ? ", one stopped" : "";
  return `${day}, ${count} ${plural}${tail}`;
}

/** The count, and whether any of it needs somebody. */
function DayCount({ count, stopped }: { count: number; stopped: boolean }) {
  if (count === 0) return null;
  return (
    <Badge variant={stopped ? "destructive" : "warning"}>
      {stopped ? `${count} · stopped` : count}
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
  const stopped = releases.some(release => release.state === "blocked");
  const count = releases.length;

  return (
    <button
      type="button"
      role="gridcell"
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
}: {
  byDay: Map<DayKey, Release[]>;
  grid: { weeks: DayKey[][] };
  month: string;
  zone: string;
}) {
  const days = grid.weeks
    .flat()
    .filter(day => day.startsWith(month))
    .filter(day => (byDay.get(day)?.length ?? 0) > 0);

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
