"use client";

/**
 * Committing a release to an instant, in a named zone.
 *
 * Two fields and no cleverness. The date and time are entered as wall-clock
 * values and the ZONE is chosen beside them, because those are two independent
 * decisions and an editor holds them separately: "9am, Berlin" is one thought,
 * and converting it to an instant is this component's job rather than theirs.
 *
 * The zone defaults to the reader's own — the overwhelmingly common case is
 * scheduling for where you are — and stays visible so the less common case is
 * one control away rather than hidden behind an assumption.
 *
 * @module components/features/releases/ScheduleReleaseDialog
 */

import { useState } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@admin/components/ui";
import { useScheduleRelease } from "@admin/hooks/queries/useReleases";
import { isValidTimezone } from "@admin/lib/dates/format";
import type { Release } from "@admin/types/releases";

/**
 * The offset a zone is at for a given instant, as minutes east of UTC.
 *
 * Derived by asking the platform to format the instant in that zone and reading
 * the parts back, which is the only way to get it: `Intl` exposes zones through
 * formatting and offers no arithmetic. Doing it per instant rather than per zone
 * is what makes daylight saving come out right — the same zone is a different
 * offset in January and July.
 */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(part => part.type === type)?.value ?? "0");

  // `hour` formats midnight as 24 under `hour12: false` in some engines, which
  // would place the reading a day late if carried through unchanged.
  const hour = read("hour") % 24;
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    hour,
    read("minute"),
    read("second")
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * How `instant` reads back as a wall-clock string in `timeZone`.
 *
 * The same `YYYY-MM-DDTHH:mm` shape a `datetime-local` input produces, so the
 * answer can be compared to what the editor typed without parsing either side.
 */
function wallTimeIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? "";
  const hour = String(Number(read("hour")) % 24).padStart(2, "0");
  return `${read("year")}-${read("month")}-${read("day")}T${hour}:${read("minute")}`;
}

/**
 * The instant at which `wall` occurs in `timeZone`, as an ISO string with `Z`.
 *
 * Both DST edges are answered here, and they need opposite treatment.
 *
 * A SPRING FORWARD deletes an hour, so the requested wall time may not exist at
 * all. Returning the solver's nearest approach schedules a different moment
 * while every screen reads as though it took: measured, `2026-03-29T02:30` in
 * `Europe/Berlin` came back as 03:30 and `2026-03-08T02:30` in
 * `America/New_York` as 01:30 — an hour late and an hour early from ONE
 * implementation. So a candidate is accepted only if it renders back as exactly
 * what was typed, and `null` otherwise.
 *
 * A FALL BACK repeats an hour, so TWO real instants render as the requested
 * time — in Berlin on 2026-10-25, `00:30Z` and `01:30Z` both read as 02:30. A
 * single-candidate solver silently returns whichever its arithmetic lands on,
 * which is the later one; "02:30 that day" means the first, and an editor who
 * meant the second would have to be able to say so, which this input cannot
 * express. So both offsets in play around the instant are tried and the EARLIER
 * surviving candidate wins.
 *
 * Offsets are read at a full day either side rather than derived from one
 * guess, because that is what makes both members of the ambiguous pair
 * reachable — a transition is at most a couple of hours wide and always falls
 * inside that window.
 */
export function instantFor(wall: string, timeZone: string): string | null {
  // `datetime-local` yields `YYYY-MM-DDTHH:mm`, which `Date.parse` reads as
  // LOCAL time. Appending `Z` reads the same digits as UTC, which is the anchor
  // every candidate below is measured from.
  const asUtc = new Date(`${wall}:00.000Z`);
  if (Number.isNaN(asUtc.getTime())) return null;

  const DAY = 86_400_000;
  const offsets = new Set([
    offsetMinutesAt(new Date(asUtc.getTime() - DAY), timeZone),
    offsetMinutesAt(asUtc, timeZone),
    offsetMinutesAt(new Date(asUtc.getTime() + DAY), timeZone),
  ]);

  const candidates = [...offsets]
    .map(offset => new Date(asUtc.getTime() - offset * 60_000))
    // The round trip is the whole guarantee: an offset that does not reproduce
    // the typed wall time is not this zone's offset at that moment.
    .filter(candidate => wallTimeIn(candidate, timeZone) === wall)
    .sort((a, b) => a.getTime() - b.getTime());

  return candidates[0]?.toISOString() ?? null;
}

/** The reader's own zone, or UTC where the platform will not name one. */
function readerZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimezone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

export interface ScheduleReleaseDialogProps {
  release: Release;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScheduleReleaseDialog({
  release,
  open,
  onOpenChange,
}: ScheduleReleaseDialogProps) {
  const [wall, setWall] = useState("");
  const [zone, setZone] = useState(() => release.timezone ?? readerZone());
  const schedule = useScheduleRelease(release.id);

  const zoneUsable = isValidTimezone(zone);
  const instant = wall && zoneUsable ? instantFor(wall, zone) : null;
  // A wall time the zone SKIPS, which is a different failure from an empty box
  // or an unknown zone: the editor typed something real that this zone does not
  // have on that date, and needs to be told so rather than given a near miss.
  const skipped = Boolean(wall) && zoneUsable && instant === null;
  // Scheduling a release for a moment that has passed publishes it on the next
  // tick, which is a surprising way to make something live. Named as a warning
  // rather than a refusal: the drain genuinely does handle it, and an editor
  // correcting a missed launch window is doing it on purpose.
  const inThePast =
    instant !== null && new Date(instant).getTime() < Date.now();
  const canSubmit = instant !== null && !schedule.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={event => {
            event.preventDefault();
            if (!canSubmit) return;
            schedule.mutate(
              { at: instant, timezone: zone },
              { onSuccess: () => onOpenChange(false) }
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Schedule this release</DialogTitle>
            <DialogDescription>
              Everything in this release goes live at the moment you choose.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="release-instant">Date and time</Label>
              <Input
                id="release-instant"
                type="datetime-local"
                value={wall}
                autoFocus
                onChange={event => setWall(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="release-zone">Timezone</Label>
              <Input
                id="release-zone"
                value={zone}
                onChange={event => setZone(event.target.value)}
                placeholder="Europe/Berlin"
                aria-invalid={!zoneUsable || undefined}
                aria-describedby="release-zone-help"
              />
              <p
                id="release-zone-help"
                className="text-sm text-muted-foreground"
              >
                {zoneUsable
                  ? "The time above is read in this zone, and stored with it — so a daylight-saving change does not move the launch."
                  : "Not a timezone this browser recognises. Use an IANA name such as Europe/Berlin."}
              </p>
            </div>

            {skipped ? (
              <p role="alert" className="text-sm text-destructive">
                {zone} has no such time on that date — the clocks go forward and
                that hour does not exist. Pick a time before or after it.
              </p>
            ) : null}

            {inThePast ? (
              <p role="status" className="text-sm text-warning-foreground">
                That moment has already passed — this release will go live at
                the next check rather than waiting.
              </p>
            ) : null}

            {schedule.isError ? (
              <p role="alert" className="text-sm text-destructive">
                The release could not be scheduled.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {schedule.isPending ? "Scheduling…" : "Schedule release"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
