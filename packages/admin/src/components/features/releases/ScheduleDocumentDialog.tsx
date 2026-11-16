"use client";

/**
 * Scheduling one document from its editor, three ways: on its own at a time,
 * with a release that already exists, or in a new release named here. Then
 * whether, at that moment, it goes live or comes down.
 *
 * On its own, the dialog asks the two decisions the release dialog asks, a
 * wall-clock time and the zone it is read in, with the same arithmetic
 * (`release-timezone`), and reads the moment back in words before anything is
 * sent: a scheduling mistake is a document changing at the wrong moment, so the
 * moment is said, not left to be worked out from two fields.
 *
 * Every way is ONE request. The server makes or finds the release, puts the
 * document in it and, on its own, schedules it, together or not at all, so a
 * refusal leaves nothing half-done behind. A refusal for the document's hard
 * problems is said here, one line per problem, and the dialog stays open.
 *
 * Loaded on first use: the editor carries none of it until somebody asks.
 *
 * @module components/features/releases/ScheduleDocumentDialog
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
  RadioGroup,
  RadioGroupItem,
} from "@admin/components/ui";
import { useScheduleDocument } from "@admin/hooks/queries/useReleases";
import { useCan } from "@admin/hooks/useCan";
import type {
  Release,
  ReleaseDocumentRef,
  ReleaseMemberAction,
  ScheduleDocumentPayload,
} from "@admin/types/releases";

import { focusAfterScheduling, returnFocusTo } from "./dialog-opener";
import { isDefiniteRefusal, releaseErrorMessage } from "./release-error";
import { describeRelease } from "./release-schedule";
import { releaseTimeText, type ReleaseTimeText } from "./release-time";
import { instantFor, readerZone, wallTimeIn } from "./release-timezone";
import {
  initialReleaseAction,
  ReleaseActionChoice,
} from "./ReleaseActionChoice";
import { ReleaseNameFields } from "./ReleaseNameFields";
import { ReleaseZonePicker } from "./ReleaseZonePicker";
import {
  defaultScheduleWall,
  languagesSentence,
  OWN_NEEDS_SCHEDULING,
  refusalLines,
  scheduledReleaseTitle,
  scheduleTimeProblem,
  scheduleTimeProblemText,
  type ScheduleWay,
} from "./schedule-publish";
import { useMinuteClock } from "./useMinuteClock";
import { useScheduleTargets } from "./useScheduleTargets";
import { useSchedulingInFlight } from "./useSchedulingInFlight";

export interface ScheduleDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: ReleaseDocumentRef;
  /** The document's title as saved, which names a release of its own. */
  documentTitle: string | undefined;
  /** Whether saving writes what readers see at once, with no draft between. */
  savesGoLive: boolean;
  /** The control to hand focus back to on close, where it is still there. */
  opener: HTMLElement | null;
  /**
   * The site's content languages, where the document is translated: a
   * release moves every language together, and the dialog says so.
   */
  languages?: readonly string[];
  /** Whether the form holds edits not saved yet, which a release does not ship. */
  hasUnsavedEdits?: boolean;
}

export function ScheduleDocumentDialog({
  open,
  onOpenChange,
  document,
  documentTitle,
  savesGoLive,
  opener,
  languages = [],
  hasUnsavedEdits = false,
}: ScheduleDocumentDialogProps): JSX.Element {
  const f = useScheduleDocumentForm({
    open,
    onOpenChange,
    document,
    documentTitle,
    opener,
  });
  return (
    <Dialog open={open} onOpenChange={f.requestOpenChange}>
      <DialogContent
        onCloseAutoFocus={event => returnFocusTo(f.returnTo.current, event)}
        className="w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto"
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={event => {
            event.preventDefault();
            f.submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Schedule “{f.title}”</DialogTitle>
            <DialogDescription>
              Choose how it goes out, then whether it goes live or comes down.{" "}
              {descriptionTail(f.action, savesGoLive)}
            </DialogDescription>
          </DialogHeader>

          <WayChoice
            ids={f.ids}
            way={f.way}
            onChange={f.setWay}
            canScheduleReleases={f.canScheduleReleases}
          />

          <WayDetails
            way={f.way}
            own={f.own}
            now={f.now}
            timeProblem={f.timeProblem}
            readback={f.readback}
            action={f.action}
            targets={f.targets}
            releaseId={f.releaseId}
            onChoose={f.setReleaseId}
            search={f.search}
            onSearch={f.setSearch}
            onStartNew={() => f.setWay("new")}
            newTitle={f.newTitle}
            onTitleChange={f.onTitleChange}
            newDescription={f.newDescription}
            onDescriptionChange={f.setNewDescription}
            newTitleMissing={f.newTitleMissing}
          />

          <ReleaseActionChoice
            action={f.action}
            onChange={f.setAction}
            canPublishDocument={f.canPublishDocument}
            canUnpublishDocument={f.canUnpublishDocument}
          />

          <DocumentNotes
            languages={languages}
            hasUnsavedEdits={hasUnsavedEdits}
          />

          <Refusal request={f.schedule} action={f.action} />

          <ScheduleFooter
            sending={f.sending}
            ready={f.ready}
            confirm={confirmLabel(f.way, f.readback, f.chosen)}
            onCancel={() => f.requestOpenChange(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Everything the dialog holds and works out: the way and action chosen, the time, the release to
 * join or make, the request, and the handlers its controls call.
 */
function useScheduleDocumentForm({
  open,
  onOpenChange,
  document,
  documentTitle,
  opener,
}: Pick<
  ScheduleDocumentDialogProps,
  "open" | "onOpenChange" | "document" | "documentTitle" | "opener"
>) {
  const ids = useId();
  const title = scheduledReleaseTitle(documentTitle);
  // On its own, the release is scheduled at once, which the server asks
  // permission to schedule releases for.
  const canScheduleReleases = useCan("publish-content-releases");
  const [way, setWay] = useState<ScheduleWay>(initialWay(canScheduleReleases));
  // Going live or coming down, each on the document's own grant.
  const canPublishDocument = useCan(`publish-${document.scopeSlug}`);
  const canUnpublishDocument = useCan(`unpublish-${document.scopeSlug}`);
  const [action, setAction] = useState<ReleaseMemberAction>(() =>
    initialReleaseAction(canPublishDocument)
  );
  const own = useOwnTime();
  const [releaseId, setReleaseId] = useState("");
  const [search, setSearch] = useState("");
  const targets = useScheduleTargets(search, asksForTargets(open, way));
  const chosen = targets.items.find(release => release.id === releaseId);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newTitleMissing, setNewTitleMissing] = useState(false);

  const request = useSchedulingRequest({ document, opener, onOpenChange });
  const { schedule, sending, send, requestOpenChange, returnTo } = request;
  // The clock, or the moment a send found the time passed between its ticks.
  const now = Math.max(request.now, own.checkedAt);
  const timeProblem = scheduleTimeProblem(own.wall, own.instant, now);
  const readback = ownReadback(own, timeProblem, now);

  const payload = () =>
    schedulePayload({
      way,
      scheduled: { ...document, action },
      title,
      own,
      timeProblem,
      chosen,
      newTitle,
      newDescription,
    });

  const submit = () =>
    submitSchedule({
      way,
      newTitle,
      own,
      payload,
      send,
      onTitleMissing: () => setNewTitleMissing(true),
    });

  const ready = wayIsReady(way, timeProblem, chosen);

  return {
    ids,
    title,
    canScheduleReleases,
    way,
    setWay,
    canPublishDocument,
    canUnpublishDocument,
    action,
    setAction,
    own,
    releaseId,
    setReleaseId,
    search,
    setSearch,
    targets,
    chosen,
    newTitle,
    newDescription,
    setNewDescription,
    newTitleMissing,
    schedule,
    sending,
    requestOpenChange,
    returnTo,
    now,
    timeProblem,
    readback,
    ready,
    submit,
    onTitleChange: (next: string) => {
      setNewTitle(next);
      setNewTitleMissing(false);
    },
  };
}

/** The way a dialog opens on: on its own where the reader may schedule releases. */
function initialWay(canScheduleReleases: boolean): ScheduleWay {
  return canScheduleReleases ? "own" : "existing";
}

/** Whether the releases a document may join are read: only while that way is open. */
function asksForTargets(open: boolean, way: ScheduleWay): boolean {
  return open && way === "existing";
}

/**
 * Send the request for the way chosen, or say in place why it cannot go yet. A new release with
 * no name is refused with the focus on its field. On its own, the time is asked again at the
 * moment of sending: the clock moves once a minute, and a time can pass while the dialog sits
 * open.
 */
function submitSchedule(args: {
  way: ScheduleWay;
  newTitle: string;
  own: Pick<OwnTime, "stillValid">;
  payload: () => ScheduleDocumentPayload | null;
  send: (body: ScheduleDocumentPayload) => void;
  onTitleMissing: () => void;
}): void {
  if (args.way === "new" && args.newTitle.trim() === "") {
    args.onTitleMissing();
    return;
  }
  if (args.way === "own" && !args.own.stillValid()) return;
  const body = args.payload();
  if (body !== null) args.send(body);
}

/** The chosen moment read back in words, once it is one that can be scheduled. */
function ownReadback(
  own: OwnTime,
  timeProblem: ReturnType<typeof scheduleTimeProblem>,
  now: number
): ReleaseTimeText | null {
  if (timeProblem !== null) return null;
  return releaseTimeText(own.instant, {
    readerZone: own.reader,
    scheduledZone: own.zone,
    now,
  });
}

/** What the description adds for a document going live: whether a save before then ships. */
function descriptionTail(
  action: ReleaseMemberAction,
  savesGoLive: boolean
): string | null {
  return action === "publish" ? savingBeforeThen(savesGoLive) : null;
}

/** How it goes out: on its own, with an existing release, or in a new one. */
function WayChoice({
  ids,
  way,
  onChange,
  canScheduleReleases,
}: {
  ids: string;
  way: ScheduleWay;
  onChange: (next: ScheduleWay) => void;
  canScheduleReleases: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">How it goes out</legend>
      <RadioGroup
        value={way}
        onValueChange={next => onChange(next as ScheduleWay)}
      >
        <WayOption
          id={`${ids}-own`}
          value="own"
          label="On its own, at a time"
          hint="A release of one, named after this document."
          held={canScheduleReleases ? undefined : OWN_NEEDS_SCHEDULING}
        />
        <WayOption
          id={`${ids}-existing`}
          value="existing"
          label="With an existing release"
        />
        <WayOption
          id={`${ids}-new`}
          value="new"
          label="In a new release"
          hint="You schedule the new release from its page."
        />
      </RadioGroup>
    </fieldset>
  );
}

/** Cancel, and the confirm that names what it does, held while a request is on its way. */
function ScheduleFooter({
  sending,
  ready,
  confirm,
  onCancel,
}: {
  sending: boolean;
  ready: boolean;
  confirm: string;
  onCancel: () => void;
}) {
  return (
    <DialogFooter>
      <Button
        type="button"
        variant="outline"
        disabled={sending}
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button type="submit" disabled={!ready || sending}>
        {sending ? "Scheduling…" : confirm}
      </Button>
    </DialogFooter>
  );
}

/** What a request is made from: the way chosen and what each way asks for. */
interface PayloadParts {
  way: ScheduleWay;
  scheduled: ScheduleDocumentPayload["document"];
  /** The name a release of its own takes. */
  title: string;
  own: Pick<OwnTime, "instant" | "zone">;
  timeProblem: ReturnType<typeof scheduleTimeProblem>;
  chosen: Release | undefined;
  newTitle: string;
  newDescription: string;
}

/** The request for the way chosen, or null where it cannot be sent yet. */
function schedulePayload(parts: PayloadParts): ScheduleDocumentPayload | null {
  const { way, scheduled, own } = parts;
  if (way === "own") {
    if (own.instant === null || parts.timeProblem !== null) return null;
    return {
      into: "own",
      document: scheduled,
      title: parts.title,
      at: own.instant,
      timezone: own.zone,
    };
  }
  if (way === "existing") {
    return parts.chosen === undefined
      ? null
      : { into: "existing", document: scheduled, releaseId: parts.chosen.id };
  }
  const named = parts.newTitle.trim();
  return named === ""
    ? null
    : {
        into: "new",
        document: scheduled,
        title: named,
        description: parts.newDescription.trim() || null,
      };
}

/**
 * Whether the way chosen has what it needs to be confirmed. A new release with no name is let
 * through, so the confirm says in place which field is missing.
 */
function wayIsReady(
  way: ScheduleWay,
  timeProblem: ReturnType<typeof scheduleTimeProblem>,
  chosen: Release | undefined
): boolean {
  if (way === "own") return timeProblem === null;
  if (way === "existing") return chosen !== undefined;
  return true;
}

/** What the way chosen asks for: a time, a release to join, or the new release's name. */
function WayDetails(props: {
  way: ScheduleWay;
  own: OwnTime;
  now: number;
  timeProblem: ReturnType<typeof scheduleTimeProblem>;
  readback: ReleaseTimeText | null;
  action: ReleaseMemberAction;
  targets: ReturnType<typeof useScheduleTargets>;
  releaseId: string;
  onChoose: (id: string) => void;
  search: string;
  onSearch: (next: string) => void;
  onStartNew: () => void;
  newTitle: string;
  onTitleChange: (next: string) => void;
  newDescription: string;
  onDescriptionChange: (next: string) => void;
  newTitleMissing: boolean;
}) {
  if (props.way === "own") {
    return (
      <OwnTimeFields
        own={props.own}
        now={props.now}
        problem={props.timeProblem}
        readback={props.readback}
        action={props.action}
      />
    );
  }
  if (props.way === "existing") {
    return (
      <ExistingReleaseChoice
        targets={props.targets}
        releaseId={props.releaseId}
        onChoose={props.onChoose}
        search={props.search}
        onSearch={props.onSearch}
        onStartNew={props.onStartNew}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ReleaseNameFields
        title={props.newTitle}
        onTitleChange={props.onTitleChange}
        description={props.newDescription}
        onDescriptionChange={props.onDescriptionChange}
        autoFocus
        titleProblem={
          props.newTitleMissing ? "Name the new release." : undefined
        }
      />
    </div>
  );
}

/** What the reader should know about the document itself: its languages, and unsaved edits. */
function DocumentNotes({
  languages,
  hasUnsavedEdits,
}: {
  languages: readonly string[];
  hasUnsavedEdits: boolean;
}) {
  return (
    <>
      {languages.length > 1 ? (
        <p className="text-sm text-muted-foreground">
          {languagesSentence(languages)}
        </p>
      ) : null}
      {hasUnsavedEdits ? (
        <p className="text-sm text-muted-foreground">
          Unsaved changes aren&apos;t included until you save them. The release
          ships the document as it is saved at that moment.
        </p>
      ) : null}
    </>
  );
}

/** One way out, with what it means, and the reason where it is held. */
function WayOption({
  id,
  value,
  label,
  hint,
  held,
}: {
  id: string;
  value: ScheduleWay;
  label: string;
  hint?: string;
  held?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <RadioGroupItem
          value={value}
          id={id}
          disabled={held !== undefined}
          aria-describedby={hint || held ? `${id}-note` : undefined}
        />
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
      </div>
      {hint || held ? (
        <p id={`${id}-note`} className="pl-6 text-xs text-muted-foreground">
          {held ?? hint}
        </p>
      ) : null}
    </div>
  );
}

/** The time and zone of a schedule on its own, and how they read. */
function useOwnTime() {
  const reader = readerZone();
  const [zone, setZone] = useState(reader);
  const [wall, setWall] = useState(() => defaultScheduleWall(Date.now(), zone));
  /*
   * When a send found the chosen time passed between the clock's ticks: the
   * moment it checked, so the dialog says so at once rather than leaving
   * Schedule apparently doing nothing until the next tick.
   */
  const [checkedAt, setCheckedAt] = useState(0);
  const instant = wall === "" ? null : instantFor(wall, zone);
  return {
    reader,
    zone,
    setZone,
    wall,
    setWall,
    instant,
    checkedAt,
    /** Whether the time can still be sent, asked at the moment of sending. */
    stillValid: (): boolean => {
      const at = Date.now();
      if (scheduleTimeProblem(wall, instant, at) === null) return true;
      setCheckedAt(at);
      return false;
    },
  };
}

type OwnTime = ReturnType<typeof useOwnTime>;

function OwnTimeFields({
  own,
  now,
  problem,
  readback,
  action,
}: {
  own: OwnTime;
  now: number;
  problem: ReturnType<typeof scheduleTimeProblem>;
  readback: ReleaseTimeText | null;
  action: ReleaseMemberAction;
}) {
  const ids = useId();
  const problemId = `${ids}-problem`;
  const zoneHelpId = `${ids}-zone-help`;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${ids}-at`}>Date and time</Label>
          <Input
            id={`${ids}-at`}
            type="datetime-local"
            value={own.wall}
            // The browser's own picker greys out what has passed there.
            min={wallTimeIn(new Date(now), own.zone)}
            autoFocus
            onChange={event => own.setWall(event.target.value)}
            aria-invalid={problem !== null || undefined}
            aria-describedby={problemId}
          />
        </div>
        {/* Mounted, and not hidden, before it has anything to say, so the
            first problem is announced: a region that appears with its text
            is not reliably read. Empty, it takes no room. */}
        <p
          id={problemId}
          role="status"
          className="mt-2 text-sm text-destructive empty:mt-0"
        >
          {problem === null ? "" : scheduleTimeProblemText(problem, own.zone)}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label id={`${ids}-zone-label`} htmlFor={`${ids}-zone`}>
          Time zone
        </Label>
        <ReleaseZonePicker
          id={`${ids}-zone`}
          labelId={`${ids}-zone-label`}
          zone={own.zone}
          readerZone={own.reader}
          at={own.instant === null ? new Date(now) : new Date(own.instant)}
          onChange={own.setZone}
          describedBy={zoneHelpId}
        />
        <p id={zoneHelpId} className="text-sm text-muted-foreground">
          {
            "The time above is read in this zone and kept in it, so a clock change doesn't move it."
          }
        </p>
      </div>

      {readback === null ? null : <Readback text={readback} action={action} />}
    </div>
  );
}

/**
 * The ordinary releases a document may join, each with when it acts and how
 * many documents it holds, searched on the server.
 */
function ExistingReleaseChoice({
  targets,
  releaseId,
  onChoose,
  search,
  onSearch,
  onStartNew,
}: {
  targets: ReturnType<typeof useScheduleTargets>;
  releaseId: string;
  onChoose: (id: string) => void;
  search: string;
  onSearch: (next: string) => void;
  onStartNew: () => void;
}) {
  const ids = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${ids}-search`}>Find a release</Label>
        <Input
          id={`${ids}-search`}
          type="search"
          value={search}
          onChange={event => onSearch(event.target.value)}
          placeholder="Search by name"
        />
      </div>
      {targets.isPending ? (
        <p className="text-sm text-muted-foreground">Loading releases…</p>
      ) : targets.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          There are no draft or scheduled releases to add this to.{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={onStartNew}
          >
            Start a new one
          </button>
          .
        </p>
      ) : (
        <RadioGroup
          value={releaseId}
          onValueChange={onChoose}
          aria-label="Releases"
        >
          {targets.items.map(release => (
            <div key={release.id} className="flex items-start gap-2">
              <RadioGroupItem
                value={release.id}
                id={`${ids}-${release.id}`}
                className="mt-0.5"
              />
              <Label
                htmlFor={`${ids}-${release.id}`}
                className="flex flex-col gap-0.5 font-normal"
              >
                <span className="text-foreground">{release.title}</span>
                <span className="text-xs text-muted-foreground">
                  {releaseSummary(release)}
                </span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}
      {targets.truncated ? (
        <p className="text-xs text-muted-foreground">
          Only the most recent releases are listed. Search to find another.
        </p>
      ) : null}
    </div>
  );
}

/** When a release acts, in the release pages' words, and how many it holds. */
function releaseSummary(release: Release): string {
  const total = release.memberCounts?.total;
  const size =
    total === undefined
      ? ""
      : ` · ${total} ${total === 1 ? "document" : "documents"}`;
  return `${describeRelease(release)}${size}`;
}

/** What the confirm button says, for the way chosen. */
function confirmLabel(
  way: ScheduleWay,
  readback: ReleaseTimeText | null,
  chosen: Release | undefined
): string {
  if (way === "own") {
    return readback ? `Schedule for ${readback.local}` : "Schedule";
  }
  if (way === "existing") {
    return chosen ? `Add to ${chosen.title}` : "Add to release";
  }
  return "Create release and add";
}

/**
 * A refused or unanswered request, said where the reader is: the server's
 * sentence, then each hard problem it named, in the release page's words.
 */
function Refusal({
  request,
  action,
}: {
  /** The schedule request, whose failure this says; nothing is shown while it has not failed. */
  request: { isError: boolean; error: unknown };
  action: ReleaseMemberAction;
}) {
  const canReadReleases = useCan("read-content-releases");
  if (!request.isError) return null;
  const { error } = request;
  const lines = isDefiniteRefusal(error) ? refusalLines(error, action) : [];
  return (
    <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
      <p>{failureText(error, canReadReleases)}</p>
      {lines.length > 0 ? (
        <ul className="list-disc pl-5">
          {lines.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The one request, and what guards it: the clock it is checked against,
 * closing refused while it is out, and where focus goes once it lands.
 */
function useSchedulingRequest({
  document,
  opener,
  onOpenChange,
}: {
  document: ReleaseDocumentRef;
  opener: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
}) {
  const now = useMinuteClock();
  // Where focus goes when the dialog closes: the opener, or after a
  // schedule lands or may have landed, where its outcome is shown.
  const returnTo = useRef(opener);
  const schedule = useScheduleDocument(document);
  // This dialog's request, or one for the same document from a dialog
  // before it: every send runs under the document's key, so the cache's
  // answer covers this dialog's own request too, and is the only one read,
  // so the dialog and the action's hold never disagree.
  const { inFlight: sending, inFlightNow } = useSchedulingInFlight(document);

  /*
   * Closing is refused while the request is out. The step makes a new
   * release each time it is asked, so a dialog closed and opened again
   * around a slow request would send a second one and schedule the document
   * twice.
   */
  const requestOpenChange = (next: boolean) => {
    if (!next && sending) return;
    onOpenChange(next);
  };

  const send = (payload: ScheduleDocumentPayload) => {
    // Asked of the cache rather than of this render, which a second press
    // in the same turn as the first still sees with nothing out.
    if (inFlightNow()) return;
    schedule.mutate(payload, {
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
    });
  };

  return { now, schedule, sending, send, requestOpenChange, returnTo };
}

/**
 * The chosen moment in words, on the reader's clock, and on the chosen
 * zone's where that reads differently: the line the person checks before
 * they press Schedule.
 */
function Readback({
  text,
  action,
}: {
  text: ReleaseTimeText;
  action: ReleaseMemberAction;
}) {
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
          {action === "publish" ? "Goes live" : "Comes down"}{" "}
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
 * What saving before the release falls due does. A save waits for the
 * release only where it lands in a draft: on a live document whose
 * collection or Single keeps no drafts, it is published at once, and saying
 * otherwise would lead an editor to publish planned content early.
 */
function savingBeforeThen(savesGoLive: boolean): string {
  return savesGoLive
    ? "It is already published, so changes you save before then go live as soon as you save them."
    : "Changes you save before then go out with it.";
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
      ? "No answer came back, so this may have been scheduled. Check the releases listed on this document before trying again."
      : "No answer came back, so this may have been scheduled. Ask someone who can see releases to check before trying again, so it isn't scheduled twice.";
  }
  return releaseErrorMessage(
    error,
    "This document could not be scheduled. Nothing was changed."
  );
}
