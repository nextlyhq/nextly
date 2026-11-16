/**
 * The header's save indicator: whether the document's work is stored.
 *
 * It reports the document's own save — `saveState`, the one answer every
 * surface reads — and nothing else. It used to report the recovery point the
 * editor records while an author types, so "Saved" could sit over work that
 * was never stored and "Saving..." flickered on every pause; a recovery point
 * is a safety net, not a save, and its line now lives in the tooltip of the
 * state it qualifies.
 *
 * Its width is reserved whatever it says, so moving between states never
 * shifts the controls beside it.
 *
 * @module components/features/entries/EntryForm/SaveStateIndicator
 */
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nextlyhq/ui";
import type { JSX } from "react";
import { useId, useState } from "react";

import {
  AlertCircle,
  Check,
  ChevronDown,
  Cloud,
  Loader2,
  RotateCcw,
} from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { OLDER_VERSION_WARNING } from "./AutosaveRecoveryBanner";
import { WORDS_IN_NARROW_BAR } from "./narrow-bar";
import {
  useClaimRecoveryOffer,
  type HostedRecoveryOffer,
} from "./RecoveryOfferContext";
import { formatTimeAgo } from "./time-ago";
import type { DocumentSaveState } from "./useDocumentActionBindings";

/** The recovery point beside the document, for the tooltip that mentions it. */
export interface RecoveryPointState {
  /** Whether a recovery point can be recorded for this document at all. */
  enabled: boolean;
  /** When the latest recovery point was stored, if one has been. */
  storedAt: Date | null;
  /**
   * When a recovery point NEWER than the stored document was made, while it is
   * still on offer. Its edits are in the recovery point only, so the document
   * is not saved with them, whatever the form says.
   */
  pendingOfferAt: Date | null;
}

/**
 * How the opened document stands in storage, for a surface that reports it
 * saved from the moment it opens: when it was stored, or null when the time
 * isn't known (a working draft, whose row keeps the published time).
 */
export interface StoredDocument {
  at: Date | null;
}

/**
 * What the offer's popover says first while changes from the author's last
 * visit wait, in a view whose chip makes the recovery offer: the chip itself
 * keeps the bar's one short status, "Unsaved changes".
 */
const LAST_VISIT_NOTICE = "Changes from your last visit aren't saved yet.";

/**
 * What the indicator draws: one of the four states, the changes from a last
 * visit waiting to be saved, or nothing to say.
 */
export type SaveIndicatorView =
  | { tone: "saving"; label: string }
  | { tone: "offered"; label: string }
  | { tone: "unsaved"; label: string; detail: string | null }
  | { tone: "saved"; label: string; detail: string }
  | {
      tone: "failed";
      label: string;
      detail: string;
      retry: Extract<DocumentSaveState, { kind: "failed" }>["retry"];
    }
  | null;

/** The recovery point's line for an unsaved document, if it has one. */
function recoveryLine(recovery: RecoveryPointState): string | null {
  if (recovery.storedAt !== null) {
    return `Recovery point stored ${formatTimeAgo(recovery.storedAt)}. Newer changes not in it yet.`;
  }
  return recovery.enabled ? "A recovery point will be stored shortly" : null;
}

/**
 * What the indicator says for a save state, decided apart from drawing it so
 * every state is answerable without rendering a header.
 */
export function saveIndicatorView(
  saveState: DocumentSaveState,
  recovery: RecoveryPointState,
  /**
   * How the opened document stands in storage, for a surface that reports it
   * as saved from the moment it opens. Absent, an opened document says nothing
   * until it is saved.
   */
  stored: StoredDocument | null = null,
  /**
   * Whether this chip makes the recovery offer itself, with Save and Discard
   * (a view whose own bar shows the save state). The entry and Single pages
   * make it in a banner, and say "Unsaved changes" here as before.
   */
  offerInChip = false
): SaveIndicatorView {
  switch (saveState.kind) {
    case "failed":
      return {
        tone: "failed",
        label: "Not saved",
        detail: saveState.message,
        retry: saveState.retry,
      };
    case "saving":
      return { tone: "saving", label: "Saving..." };
    case "unsaved":
      return {
        tone: "unsaved",
        label: "Unsaved changes",
        detail: recoveryLine(recovery),
      };
    case "saved": {
      // The changes from the last visit: unsaved, and the bar's Save keeps
      // them (it is offered while they wait), so "Unsaved changes" never sits
      // beside a Save that does nothing. The chip's popover says what they
      // are, with Save and Discard.
      if (offerInChip) return { tone: "offered", label: "Unsaved changes" };
      // Never "Saved" over edits that live only in a recovery point.
      if (recovery.pendingOfferAt !== null) {
        return {
          tone: "unsaved",
          label: "Unsaved changes",
          detail: `Recovery point stored ${formatTimeAgo(recovery.pendingOfferAt)}`,
        };
      }
      // Nothing stored this session and nothing pending: an opened document is
      // saved as of its stored time where the surface knows it, and otherwise
      // has nothing to report yet.
      const savedAt = saveState.at ?? stored?.at ?? null;
      if (savedAt !== null) {
        return {
          tone: "saved",
          label: "Saved",
          detail: `Saved ${formatTimeAgo(savedAt)}`,
        };
      }
      // Stored, at a time nothing here can tell: said without an age rather
      // than with the wrong one.
      if (stored === null) return null;
      return {
        tone: "saved",
        label: "Saved",
        detail: "Changes saved as a draft",
      };
    }
  }
}

/** A failed save: what failed, and a Retry reachable from the keyboard. */
function FailedSaveState({
  view,
}: {
  view: Extract<NonNullable<SaveIndicatorView>, { tone: "failed" }>;
}) {
  const detailId = useId();
  return (
    <>
      <AlertCircle
        className="h-4 w-4 shrink-0 text-danger-text"
        aria-hidden="true"
      />
      <span
        className={cn(
          "whitespace-nowrap text-danger-text",
          WORDS_IN_NARROW_BAR
        )}
      >
        {view.label}
      </span>
      <span id={detailId} className="sr-only">
        {view.detail}
      </span>
      {view.retry === undefined ? (
        // A failure nothing here can try again offers no Retry that would
        // only fail again. Details opens what failed on a click and stays
        // open to be read: a tooltip closes on the press that would open it.
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              aria-describedby={detailId}
            >
              Details
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" side="bottom" className="w-72 text-sm">
            <p>{view.detail}</p>
          </PopoverContent>
        </Popover>
      ) : (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A real button, so Retry is reachable from the keyboard and
                  focusing it shows what failed. */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                aria-describedby={detailId}
                onClick={() => {
                  void view.retry?.();
                }}
              >
                Retry
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              <p>{view.detail}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </>
  );
}

/** Each settled state's icon. */
const SETTLED_ICON = {
  saving: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
  // No dark variant: `success` is tuned to read in both modes.
  saved: <Check className="h-4 w-4 text-success" />,
  unsaved: <Cloud className="h-4 w-4 text-muted-foreground" />,
};

/** Saving, unsaved or saved: an icon, a label, and a line about it. */
function SettledSaveState({
  view,
}: {
  view: Exclude<
    NonNullable<SaveIndicatorView>,
    { tone: "failed" } | { tone: "offered" }
  >;
}) {
  const detail = view.tone === "saving" ? null : view.detail;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5">
            {SETTLED_ICON[view.tone]}
            {/* One line at every width: a label that wraps grows the bar. */}
            <span className={cn("whitespace-nowrap", WORDS_IN_NARROW_BAR)}>
              {view.label}
            </span>
          </div>
        </TooltipTrigger>
        {detail === null ? null : (
          <TooltipContent side="bottom" align="end">
            <p>{detail}</p>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

/** One of an offer's two answers: its words, what it runs, and why it can't. */
interface OfferAnswer {
  label: string;
  run: () => void;
  /** Why it cannot run at this instant, when it cannot. */
  disabledReason?: string;
}

/**
 * A recovery offer made in the chip: the chip's words are the control, with
 * the restore mark and an arrow, and its popover says when the work is from,
 * warns where it is from an older version, and asks. One drawing for both
 * offers, so they cannot come to look or behave differently.
 */
function OfferChip({
  label,
  purpose,
  offer,
  lead,
  leave,
  take,
  notice,
}: {
  label: string;
  /** What the popover holds, said after the label to a screen reader. */
  purpose: string;
  offer: HostedRecoveryOffer;
  /** The popover's sentence, before when the work is from. */
  lead: string;
  /** The quiet answer, first. */
  leave: OfferAnswer;
  /** The answer that acts, last. */
  take: OfferAnswer;
  /** A sentence said first in the popover, above when the work is from. */
  notice?: string;
}): JSX.Element {
  // Made here, so the banner a document view would draw stands down.
  useClaimRecoveryOffer();
  const [open, setOpen] = useState(false);
  const answer = (choice: () => void) => () => {
    setOpen(false);
    choice();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${purpose}`}
          className="-mx-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-foreground hover:bg-muted data-[state=open]:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className={cn("whitespace-nowrap", WORDS_IN_NARROW_BAR)}>
            {label}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-sm">
        {notice === undefined ? null : (
          <p className="mb-1 font-medium text-foreground">{notice}</p>
        )}
        <p
          className={
            notice === undefined ? "text-foreground" : "text-muted-foreground"
          }
        >
          {lead}{" "}
          <span className="font-medium">{formatTimeAgo(offer.savedAt)}</span>.
        </p>
        {offer.olderVersion === true ? (
          <p className="mt-1 text-muted-foreground">{OLDER_VERSION_WARNING}</p>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          {[leave, take].map((each, index) => (
            <Button
              key={each.label}
              type="button"
              size="sm"
              {...(index === 0 ? { variant: "ghost" as const } : {})}
              disabled={each.disabledReason !== undefined}
              {...(each.disabledReason === undefined
                ? {}
                : { title: each.disabledReason })}
              onClick={answer(each.run)}
            >
              {each.label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The recovery offer, made in the chip once something else has changed:
 * "Unsaved changes" is itself the control. One save state, so no banner above
 * the editor says the same thing in a second place; and no button beside it,
 * so the top bar is no wider than it is for unsaved work alone.
 */
function RecoveryOfferChip({
  label,
  offer,
}: {
  label: string;
  offer: HostedRecoveryOffer;
}): JSX.Element {
  return (
    <OfferChip
      label={label}
      purpose="restore options"
      offer={offer}
      lead="You have unsaved changes from"
      // "Not now", not "Discard": the recovery point is kept, and offered
      // again the next time the document opens.
      leave={{ label: "Not now", run: offer.dismiss }}
      take={{ label: "Restore", run: offer.restore }}
    />
  );
}

/** The document's Save, as the chip's offer runs it. */
export interface OfferedSave {
  run: () => void;
  /** Why Save cannot run at this instant, when it cannot. */
  disabledReason?: string;
}

/**
 * Changes from the last visit, waiting: the chip says "Unsaved changes", the
 * bar's one short status, and its popover says what they are and when they
 * are from, with Save, which keeps them (the document's own Save, offered
 * while they wait), and Discard, which stops offering them.
 */
function LastVisitChip({
  label,
  offer,
  save,
}: {
  label: string;
  offer: HostedRecoveryOffer;
  save: OfferedSave;
}): JSX.Element {
  return (
    <OfferChip
      label={label}
      purpose="Save or Discard"
      offer={offer}
      notice={LAST_VISIT_NOTICE}
      lead="You made them"
      leave={{ label: "Discard", run: offer.dismiss }}
      take={{ label: "Save", ...save }}
    />
  );
}

/**
 * Saving, in a chip that makes the recovery offer: the offer stays claimed,
 * so a save does not bring the banner up for the moment it takes.
 */
function SavingWithOffer({
  view,
}: {
  view: Extract<NonNullable<SaveIndicatorView>, { tone: "saving" }>;
}): JSX.Element {
  useClaimRecoveryOffer();
  return <SettledSaveState view={view} />;
}

export interface SaveStateIndicatorProps {
  saveState: DocumentSaveState;
  recovery: RecoveryPointState;
  /**
   * A recovery point on offer, made here rather than in a banner, by a
   * surface that shows the save state in its own bar.
   */
  offer?: HostedRecoveryOffer | null;
  /** How the opened document stands in storage; see `saveIndicatorView`. */
  stored?: StoredDocument | null;
  /**
   * The document's Save, for the offer made here: given with `offer`, the
   * chip says changes from the last visit wait and offers Save and Discard.
   */
  save?: OfferedSave;
  className?: string;
}

/**
 * What the chip draws for a view: the failure with its Retry, an offer made
 * here, or the settled state, each in the one place a state is drawn.
 */
function SaveIndicatorBody({
  view,
  offer,
  save,
}: {
  view: NonNullable<SaveIndicatorView>;
  offer: HostedRecoveryOffer | null;
  save: OfferedSave | undefined;
}): JSX.Element | null {
  if (view.tone === "failed") return <FailedSaveState view={view} />;
  if (view.tone === "offered") {
    return offer === null || save === undefined ? null : (
      <LastVisitChip label={view.label} offer={offer} save={save} />
    );
  }
  if (offer === null) return <SettledSaveState view={view} />;
  // A chip that makes the offer keeps it while a save is under way, so the
  // banner does not come up for the moment the save takes.
  if (view.tone === "saving" && save !== undefined) {
    return <SavingWithOffer view={view} />;
  }
  // Only for unsaved work: the offer's edits are what keep it unsaved, and a
  // save or a failure says something else first.
  if (view.tone === "unsaved") {
    return <RecoveryOfferChip label={view.label} offer={offer} />;
  }
  return <SettledSaveState view={view} />;
}

export function SaveStateIndicator({
  saveState,
  recovery,
  stored = null,
  offer = null,
  save,
  className,
}: SaveStateIndicatorProps): JSX.Element {
  const offerInChip = offer !== null && save !== undefined;
  const view = saveIndicatorView(saveState, recovery, stored, offerInChip);

  return (
    // The reserved width: the widest state, "Not saved" with its Retry, fits
    // in it, so no state moves what follows it on the status line. Started at
    // the line's start, under the title it reports on, and labelled at every
    // width: the status line has the room a phone's action row did not.
    <div
      className={cn(
        "flex min-w-[11rem] items-center justify-start gap-1.5 text-muted-foreground in-data-[state-compact]:@max-lg/toolbar:min-w-fit",
        className
      )}
      data-testid="save-state-indicator"
      data-tone={view?.tone ?? "none"}
    >
      {view === null ? null : (
        <SaveIndicatorBody view={view} offer={offer} save={save} />
      )}
    </div>
  );
}
