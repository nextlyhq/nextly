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
import { useId, useState } from "react";

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
import type { ReleaseDocumentRef } from "@admin/types/releases";

import { returnFocusTo } from "./dialog-opener";
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
  const now = useMinuteClock();
  const reader = readerZone();
  const [zone, setZone] = useState(reader);
  const [wall, setWall] = useState(() => defaultScheduleWall(Date.now(), zone));
  const schedule = useScheduleDocument();

  const instant = wall === "" ? null : instantFor(wall, zone);
  const problem = scheduleTimeProblem(wall, instant, now);
  const readback =
    problem === null
      ? releaseTimeText(instant, {
          readerZone: reader,
          scheduledZone: zone,
          now,
        })
      : null;
  const title = scheduledReleaseTitle(documentTitle);

  const send = () => {
    // Asked again at the moment of sending: the clock above moves once a
    // minute, and a time can pass while the dialog sits open.
    if (instant === null) return;
    if (scheduleTimeProblem(wall, instant, Date.now()) !== null) return;
    schedule.mutate(
      {
        into: "own",
        document: { ...document, action: "publish" },
        title,
        at: instant,
        timezone: zone,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  const problemId = `${ids}-problem`;
  const zoneHelpId = `${ids}-zone-help`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={event => returnFocusTo(opener, event)}
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
                {failureText(schedule.error)}
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
 * where to look before trying again.
 */
function failureText(error: unknown): string {
  if (!isDefiniteRefusal(error)) {
    return "No answer came back, so this may have been scheduled. Check the Publishing section before trying again.";
  }
  return releaseErrorMessage(
    error,
    "This document could not be scheduled. Nothing was changed."
  );
}
