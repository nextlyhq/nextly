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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nextlyhq/ui";
import type { JSX } from "react";
import { useId } from "react";

import { AlertCircle, Check, Cloud, Loader2 } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

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

/** What the indicator draws: one of the four states, or nothing to say. */
export type SaveIndicatorView =
  | { tone: "saving"; label: string }
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
  recovery: RecoveryPointState
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
    case "saved":
      // Never "Saved" over edits that live only in a recovery point.
      if (recovery.pendingOfferAt !== null) {
        return {
          tone: "unsaved",
          label: "Unsaved changes",
          detail: `Recovery point stored ${formatTimeAgo(recovery.pendingOfferAt)}`,
        };
      }
      // Nothing stored this session and nothing pending: an opened document
      // has nothing to report yet.
      if (saveState.at === null) return null;
      return {
        tone: "saved",
        label: "Saved",
        detail: `Saved ${formatTimeAgo(saveState.at)}`,
      };
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
        className="h-4 w-4 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <span className="text-destructive">{view.label}</span>
      <span id={detailId} className="sr-only">
        {view.detail}
      </span>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A real button, so Retry is reachable from the keyboard and
                focusing it shows what failed. A failure nothing here can try
                again offers no Retry that would only fail again; its control
                still takes focus, to say what failed and where to fix it. */}
            {view.retry === undefined ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                aria-describedby={detailId}
              >
                Details
              </Button>
            ) : (
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
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            <p>{view.detail}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
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
  view: Exclude<NonNullable<SaveIndicatorView>, { tone: "failed" }>;
}) {
  const detail = view.tone === "saving" ? null : view.detail;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5">
            {SETTLED_ICON[view.tone]}
            <span>{view.label}</span>
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

export interface SaveStateIndicatorProps {
  saveState: DocumentSaveState;
  recovery: RecoveryPointState;
  className?: string;
}

export function SaveStateIndicator({
  saveState,
  recovery,
  className,
}: SaveStateIndicatorProps): JSX.Element {
  const view = saveIndicatorView(saveState, recovery);

  return (
    // The reserved width: the widest state, "Not saved" with its Retry, fits
    // in it, so no state moves what follows it on the status line. Started at
    // the line's start, under the title it reports on, and labelled at every
    // width: the status line has the room a phone's action row did not.
    <div
      className={cn(
        "flex min-w-[11rem] items-center justify-start gap-1.5 text-muted-foreground",
        className
      )}
      data-testid="save-state-indicator"
      data-tone={view?.tone ?? "none"}
    >
      {view === null ? null : view.tone === "failed" ? (
        <FailedSaveState view={view} />
      ) : (
        <SettledSaveState view={view} />
      )}
    </div>
  );
}
