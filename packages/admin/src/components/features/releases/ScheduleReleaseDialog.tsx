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
 * Solved rather than computed in one step: the offset depends on the instant,
 * and the instant is what is being solved for. A first guess treating the wall
 * time as UTC gives an offset that is right except across a daylight-saving
 * boundary, and one correction lands on the far side of it.
 *
 * **The answer is then CHECKED by rendering it back**, because on a spring
 * forward the requested wall time does not exist and the correction cannot land
 * on it — no instant reads as 02:30 in Berlin on the day the clocks go from
 * 02:00 to 03:00. Without the check the solver returns its nearest approach and
 * the release is scheduled for a different moment than the one that was typed:
 * measured, `2026-03-29T02:30` in `Europe/Berlin` came back as 03:30 (an hour
 * late) and `2026-03-08T02:30` in `America/New_York` as 01:30 (an hour early).
 * Silently moving a launch in either direction is worse than refusing, so this
 * returns `null` and the caller says so.
 *
 * A wall time that occurs TWICE — the autumn fall-back — round-trips correctly
 * and is accepted at its first occurrence, which is the earlier instant and the
 * one an editor naming a time on that day means.
 */
export function instantFor(wall: string, timeZone: string): string | null {
  // `datetime-local` yields `YYYY-MM-DDTHH:mm`, which `Date.parse` reads as
  // LOCAL time. Appending `Z` reads the same digits as UTC, which is the guess
  // the correction below starts from.
  const guess = new Date(`${wall}:00.000Z`);
  if (Number.isNaN(guess.getTime())) return null;

  let instant = guess;
  for (let pass = 0; pass < 2; pass++) {
    const offset = offsetMinutesAt(instant, timeZone);
    const corrected = new Date(guess.getTime() - offset * 60_000);
    if (corrected.getTime() === instant.getTime()) break;
    instant = corrected;
  }

  // The round trip is the whole guarantee. Compared to the minute, because that
  // is the precision the input offers and the seconds are always zero.
  return wallTimeIn(instant, timeZone) === wall ? instant.toISOString() : null;
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
