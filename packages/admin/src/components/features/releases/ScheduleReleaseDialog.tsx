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
import {
  useReleaseBlockers,
  useScheduleRelease,
} from "@admin/hooks/queries/useReleases";
import { isValidTimezone } from "@admin/lib/dates/format";
import type { Release, ReleaseBlocker } from "@admin/types/releases";

import { instantFor, readerZone } from "./release-timezone";

/**
 * Why a document would stop the release, in one clause.
 *
 * Shorter than the sentences on the stopped-release notice, because this list
 * is read while choosing a date rather than while repairing a failure — the
 * question here is "which documents", not "what do I do about each".
 */
const BLOCKER_SUMMARY: Record<ReleaseBlocker["reason"], string> = {
  AUTHOR_GONE: "the person who added it has been deleted or deactivated",
  NO_AUTHOR: "no author was recorded for it",
  LOCALE_SCOPED: "it names a single language, which a release cannot act on",
};


/**
 * Whether the write may be attempted at all.
 *
 * Three of these five are the same judgement: the preflight has to have
 * ANSWERED, and the answer has to be empty. Withheld while it is unknown as
 * well as while it is bad — a preflight that lets the write through on a failed
 * lookup is not a preflight, and the server refuses anyway, so nothing is lost
 * but a confusing round trip.
 */
function readyToSchedule(state: {
  instant: string | null;
  scheduling: boolean;
  checking: boolean;
  checkFailed: boolean;
  blocking: number;
}): boolean {
  if (state.instant === null || state.scheduling) return false;
  if (state.checking || state.checkFailed) return false;
  return state.blocking === 0;
}

/**
 * The documents that would stop this release, named.
 *
 * NAMED rather than counted, which is the entire reason this is asked before
 * scheduling instead of being left to the server's refusal: that refusal cannot
 * say which documents, and nobody can act on a number.
 */
function WouldStopThis({ blocking }: { blocking: ReleaseBlocker[] }) {
  if (blocking.length === 0) return null;
  return (
    <div role="alert" className="flex flex-col gap-1">
      <p className="text-sm font-medium text-destructive">
        {blocking.length === 1
          ? "One document would stop this release."
          : `${blocking.length} documents would stop this release.`}
      </p>
      <ul className="flex list-disc flex-col gap-0.5 pl-5">
        {blocking.map(blocker => (
          <li key={blocker.memberId} className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {blocker.scopeKind === "single"
                ? blocker.scopeSlug
                : `${blocker.scopeSlug} / ${blocker.entryId}`}
            </span>{" "}
            — {BLOCKER_SUMMARY[blocker.reason]}
          </li>
        ))}
      </ul>
    </div>
  );
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
  // ASKED WHILE THE DIALOG IS OPEN, which is the moment somebody is choosing
  // an instant. The server refuses a release with an unrunnable member anyway;
  // what it cannot do in that refusal is say WHICH documents, and "fix the
  // documents blocking it" is not an instruction anybody can follow without
  // that list.
  const blockers = useReleaseBlockers(release.id, open);
  const blocking = blockers.data?.items ?? [];

  const canSubmit = readyToSchedule({
    instant,
    scheduling: schedule.isPending,
    checking: blockers.isPending,
    checkFailed: blockers.isError,
    blocking: blocking.length,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={event => {
            event.preventDefault();
            // `instant` re-checked rather than asserted. `canSubmit` is
            // computed elsewhere now, so the compiler cannot narrow through it
            // — and a non-null assertion here would be a claim the type system
            // is being told to stop checking.
            if (!canSubmit || instant === null) return;
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

            <ScheduleNotices
              zone={zone}
              skipped={skipped}
              inThePast={inThePast}
              checkFailed={blockers.isError}
              scheduleFailed={schedule.isError}
            />

            <WouldStopThis blocking={blocking} />
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

/** Everything the dialog needs to say before it will accept a submission. */
function ScheduleNotices({
  zone,
  skipped,
  inThePast,
  checkFailed,
  scheduleFailed,
}: {
  zone: string;
  skipped: boolean;
  inThePast: boolean;
  checkFailed: boolean;
  scheduleFailed: boolean;
}) {
  return (
    <>
      {skipped ? (
        <p role="alert" className="text-sm text-destructive">
          {zone} has no such time on that date — the clocks go forward and that
          hour does not exist. Pick a time before or after it.
        </p>
      ) : null}

      {inThePast ? (
        <p role="status" className="text-sm text-warning-foreground">
          That moment has already passed — this release will go live at the next
          check rather than waiting.
        </p>
      ) : null}

      {checkFailed ? (
        <p role="alert" className="text-sm text-destructive">
          Whether this release can run could not be checked, so it has not been
          scheduled.
        </p>
      ) : null}

      {scheduleFailed ? (
        <p role="alert" className="text-sm text-destructive">
          The release could not be scheduled.
        </p>
      ) : null}
    </>
  );
}
