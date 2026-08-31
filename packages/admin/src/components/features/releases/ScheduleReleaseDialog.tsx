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

import { instantFor, readerZone } from "./release-timezone";

/**
 * The offset a zone is at for a given instant, as minutes east of UTC.
 *
 * Derived by asking the platform to format the instant in that zone and reading
 * the parts back, which is the only way to get it: `Intl` exposes zones through
 * formatting and offers no arithmetic. Doing it per instant rather than per zone
 * is what makes daylight saving come out right — the same zone is a different
 * offset in January and July.
 */
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
