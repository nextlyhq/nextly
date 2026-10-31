"use client";

/**
 * Choosing when one document goes live, from its editor.
 *
 * The same two decisions the release dialog asks for, a wall-clock time and
 * the zone it is read in, with the same arithmetic (`release-timezone`), and
 * the time read back in words before anything is sent: "Goes live Fri, Oct
 * 31, 9:00 AM · in 21 hours". A scheduling mistake is a document going live
 * at the wrong moment, so the moment is said, not left to be worked out from
 * two fields.
 *
 * Sent as ONE request. The server makes the release, puts the document in it
 * and schedules it together or not at all, so a refusal leaves no empty
 * release behind for somebody to find later.
 *
 * Loaded on first use: the editor carries none of it until somebody asks.
 *
 * @module components/features/releases/SchedulePublishDialog
 */
import type { JSX } from "react";
import { useId, useRef, useState } from "react";

import { CalendarClock } from "@admin/components/icons";
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
import { useScheduleDocument } from "@admin/hooks/queries/useReleases";
import { useCan } from "@admin/hooks/useCan";
import type { ReleaseDocumentRef } from "@admin/types/releases";

import { focusAfterScheduling, returnFocusTo } from "./dialog-opener";
import { isDefiniteRefusal, releaseErrorMessage } from "./release-error";
import { releaseTimeText, type ReleaseTimeText } from "./release-time";
import { instantFor, readerZone, wallTimeIn } from "./release-timezone";
import { ReleaseZonePicker } from "./ReleaseZonePicker";
import {
  defaultScheduleWall,
  scheduledReleaseTitle,
  scheduleTimeProblem,
  scheduleTimeProblemText,
} from "./schedule-publish";
import { useMinuteClock } from "./useMinuteClock";

export interface SchedulePublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: ReleaseDocumentRef;
  /** The document's title, which names the release it goes into. */
  documentTitle: string | undefined;
  /** The control to hand focus back to on close, where it is still there. */
  opener: HTMLElement | null;
}

export function SchedulePublishDialog({
  open,
  onOpenChange,
  document,
  documentTitle,
  opener,
}: SchedulePublishDialogProps): JSX.Element {
  const ids = useId();
  const reader = readerZone();
  const [zone, setZone] = useState(reader);
  const [wall, setWall] = useState(() => defaultScheduleWall(Date.now(), zone));
  const instant = wall === "" ? null : instantFor(wall, zone);
  const title = scheduledReleaseTitle(documentTitle);
  const { now, schedule, send, requestOpenChange, returnTo, canReadReleases } =
    useSchedulingRequest({
      wall,
      instant,
      zone,
      title,
      document,
      opener,
      onOpenChange,
    });

  const problem = scheduleTimeProblem(wall, instant, now);
  const readback =
    problem === null
      ? releaseTimeText(instant, {
          readerZone: reader,
          scheduledZone: zone,
          now,
        })
      : null;

  const problemId = `${ids}-problem`;
  const zoneHelpId = `${ids}-zone-help`;

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        onCloseAutoFocus={event => returnFocusTo(returnTo.current, event)}
        className="w-[calc(100%-2rem)]"
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={event => {
            event.preventDefault();
            send();
          }}
        >
          <DialogHeader>
            <DialogTitle>Schedule publish</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{title}</span> goes
              live at the time you choose. Changes you save before then go out
              with it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${ids}-at`}>Date and time</Label>
                <Input
                  id={`${ids}-at`}
                  type="datetime-local"
                  value={wall}
                  // The browser's own picker greys out what has passed there.
                  min={wallTimeIn(new Date(now), zone)}
                  autoFocus
                  required
                  onChange={event => setWall(event.target.value)}
                  aria-invalid={problem !== null || undefined}
                  aria-describedby={problemId}
                />
              </div>
              {/* Mounted, and not hidden, before it has anything to say, so
                  the first problem is announced: a region that appears with
                  its text is not reliably read. Empty, it takes no room. */}
              <p
                id={problemId}
                role="status"
                className="mt-2 text-sm text-destructive empty:mt-0"
              >
                {problem === null ? "" : scheduleTimeProblemText(problem, zone)}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label id={`${ids}-zone-label`} htmlFor={`${ids}-zone`}>
                Time zone
              </Label>
              <ReleaseZonePicker
                id={`${ids}-zone`}
                labelId={`${ids}-zone-label`}
                zone={zone}
                readerZone={reader}
                at={instant === null ? new Date(now) : new Date(instant)}
                onChange={setZone}
                describedBy={zoneHelpId}
              />
              <p id={zoneHelpId} className="text-sm text-muted-foreground">
                {
                  "The time above is read in this zone and kept in it, so a clock change doesn't move it."
                }
              </p>
            </div>

            {readback === null ? null : <Readback text={readback} />}

            {schedule.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {failureText(schedule.error, canReadReleases)}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={schedule.isPending}
              onClick={() => requestOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={problem !== null || schedule.isPending}
            >
              {schedule.isPending ? "Scheduling…" : "Schedule publish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one request, and what guards it: the clock it is checked against,
 * closing refused while it is out, and where focus goes once it lands.
 */
function useSchedulingRequest({
  wall,
  instant,
  zone,
  title,
  document,
  opener,
  onOpenChange,
}: {
  wall: string;
  instant: string | null;
  zone: string;
  title: string;
  document: ReleaseDocumentRef;
  opener: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
}) {
  const clock = useMinuteClock();
  /*
   * When a send found the chosen time passed between the clock's ticks: the
   * moment it checked, so the dialog says so at once rather than leaving
   * Schedule apparently doing nothing until the next tick.
   */
  const [checkedAt, setCheckedAt] = useState(0);
  // Whether this person can see where a schedule shows: the Publishing
  // section and the banner both read releases.
  const canReadReleases = useCan("read-content-releases");
  // Where focus goes when the dialog closes: the opener, or after a
  // schedule lands or may have landed, where its outcome is shown.
  const returnTo = useRef(opener);
  const schedule = useScheduleDocument();

  /*
   * Closing is refused while the request is out. The step makes a new
   * release each time it is asked, so a dialog closed and opened again
   * around a slow request would send a second one and schedule the document
   * twice.
   */
  const requestOpenChange = (next: boolean) => {
    if (!next && schedule.isPending) return;
    onOpenChange(next);
  };

  const send = () => {
    if (schedule.isPending || instant === null) return;
    // Asked again at the moment of sending: the clock moves once a minute,
    // and a time can pass while the dialog sits open.
    const at = Date.now();
    if (scheduleTimeProblem(wall, instant, at) !== null) {
      setCheckedAt(at);
      return;
    }
    schedule.mutate(
      {
        into: "own",
        document: { ...document, action: "publish" },
        title,
        at: instant,
        timezone: zone,
      },
      {
        onSuccess: () => {
          returnTo.current = focusAfterScheduling(opener);
          onOpenChange(false);
        },
        // A lost answer may still have scheduled it: the releases are read
        // again and the offer can go while this says so, so focus goes where
        // the outcome shows. A refusal changed nothing and keeps the opener.
        onError: error => {
          if (!isDefiniteRefusal(error)) {
            returnTo.current = focusAfterScheduling(opener);
          }
        },
      }
    );
  };

  return {
    now: Math.max(clock, checkedAt),
    schedule,
    send,
    requestOpenChange,
    returnTo,
    canReadReleases,
  };
}

/**
 * The chosen moment in words, on the reader's clock, and on the chosen
 * zone's where that reads differently: the line the person checks before
 * they press Schedule.
 */
function Readback({ text }: { text: ReleaseTimeText }) {
  return (
    <div
      className="flex items-start gap-3 rounded-md border border-border bg-muted/50 px-3 py-2.5"
      data-testid="schedule-readback"
    >
      <CalendarClock
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0 text-sm">
        <p className="text-foreground">
          Goes live{" "}
          <strong className="font-medium tabular-nums">{text.local}</strong>
          {text.scheduled ? " your time" : null}
          {/* Kept whole, so a narrow dialog never leaves the dot alone at
              the end of a line. */}{" "}
          <span className="whitespace-nowrap text-muted-foreground">
            · {text.relative}
          </span>
        </p>
        {text.scheduled ? (
          <p className="mt-0.5 text-muted-foreground">
            {text.scheduled.text} in {text.scheduled.zone}, as scheduled
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What a failed request means. A refusal changed nothing, since the step is
 * all or nothing; a lost answer may have scheduled it, and the editor is told
 * where to look before trying again. A person who may schedule but not read
 * releases has nowhere to look, since the Publishing section and the banner
 * both read them, so they are told who can.
 */
function failureText(error: unknown, canReadReleases: boolean): string {
  if (!isDefiniteRefusal(error)) {
    return canReadReleases
      ? "No answer came back, so this may have been scheduled. Check the Publishing section before trying again."
      : "No answer came back, so this may have been scheduled. Ask someone who can see releases to check before trying again, so it isn't scheduled twice.";
  }
  return releaseErrorMessage(
    error,
    "This document could not be scheduled. Nothing was changed."
  );
}
