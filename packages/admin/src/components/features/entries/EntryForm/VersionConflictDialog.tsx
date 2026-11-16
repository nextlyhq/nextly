/**
 * The conflict a save opens when the document changed since the editor's
 * copy started: who changed it and when, the edits kept on screen, and the
 * author's choices.
 *
 * - **Load current version**: the edits are kept as a recovery point that
 *   remembers the version they began from (or discarded, said so, where the
 *   document keeps none), and the form shows the current version.
 * - **Save anyway**: confirmed by a second step that says whose changes it
 *   replaces, then the edits are saved over them.
 * - **Keep editing**: closes the dialog, the edits and the refusal kept; a
 *   later save is refused again until the author chooses.
 *
 * Where history is on, a link compares the change that made the save stale.
 * Built on the same AlertDialog primitives as the other confirmations.
 *
 * @module components/features/entries/EntryForm/VersionConflictDialog
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@nextlyhq/ui";
import { useEffect, useState, type JSX } from "react";

import { Loader2 } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { formatDateTime } from "@admin/lib/dates/format";
import { changerName } from "@admin/lib/document-version";

import type { VersionConflict } from "./useVersionConflict";

export interface VersionConflictDialogProps {
  /** The refused save; the dialog is closed without one. */
  conflict: VersionConflict | null;
  /** Whether the document keeps recovery points the edits can be kept in. */
  keepsRecoveryPoints: boolean;
  /** The comparison of the change that made the save stale, where there is one. */
  compareHref: string | null;
  onLoadCurrent: () => Promise<void>;
  onSaveAnyway: () => Promise<void>;
}

/** Who changed it and when, as a sentence; nobody named where the refusal names nobody. */
function changedSentence(conflict: VersionConflict): string {
  const { changedBy, changedAt } = conflict.stale;
  if (!changedBy) return "Someone else saved it after you started.";
  const who = changerName(changedBy);
  return changedAt
    ? `${who} changed it at ${formatDateTime(changedAt)}.`
    : `${who} changed it.`;
}

/** Whose changes saving anyway replaces, and when, as a sentence. */
function replacesSentence(
  conflict: VersionConflict,
  who: string | null
): string {
  if (!who) {
    return "Saving anyway replaces the changes made since you started editing with yours.";
  }
  const { changedAt } = conflict.stale;
  const when = changedAt ? ` at ${formatDateTime(changedAt)}` : "";
  return `Saving anyway replaces the changes ${who} made${when} with yours.`;
}

/** A choice's label, or a spinner saying it is under way. */
function BusyLabel({
  busy,
  doing,
  label,
}: {
  busy: boolean;
  doing: string;
  label: string;
}): JSX.Element {
  return busy ? (
    <>
      <Loader2 className="h-4 w-4 animate-spin" />
      {doing}
    </>
  ) : (
    <>{label}</>
  );
}

type Busy = "load" | "overwrite" | null;

interface StepProps {
  conflict: VersionConflict;
  who: string | null;
  busy: Busy;
  run: (choice: "load" | "overwrite") => void;
  setStep: (step: "choose" | "confirm") => void;
}

/** The first step: what happened, and the author's choices. */
function ChooseStep({
  conflict,
  who,
  busy,
  run,
  setStep,
  keepsRecoveryPoints,
  compareHref,
}: StepProps &
  Pick<
    VersionConflictDialogProps,
    "keepsRecoveryPoints" | "compareHref"
  >): JSX.Element {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          This document changed since you started editing
        </AlertDialogTitle>
        <AlertDialogDescription>
          {changedSentence(conflict)} Your edits are still here, not saved.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <p className="text-sm text-muted-foreground">
        {keepsRecoveryPoints
          ? "Load the current version and your edits are kept as a recovery point you can restore."
          : "Load the current version and your edits are discarded: this document keeps no recovery points."}
      </p>
      {compareHref ? (
        <p className="text-sm">
          {/* In a tab of its own: the edits on screen are not saved, and
              leaving the editor for the comparison would ask to discard
              them. */}
          <Link
            href={compareHref}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {who ? `See what ${who} changed` : "See what changed"}
          </Link>
        </p>
      ) : null}
      {conflict.failure ? (
        <p role="alert" className="text-sm text-destructive">
          {conflict.failure}
        </p>
      ) : null}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy !== null}>
          Keep editing
        </AlertDialogCancel>
        {/* A step within the dialog, not a choice that closes it. */}
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={() => setStep("confirm")}
        >
          Save anyway
        </Button>
        <AlertDialogAction
          disabled={busy !== null}
          onClick={event => {
            event.preventDefault();
            run("load");
          }}
        >
          <BusyLabel
            busy={busy === "load"}
            doing="Loading..."
            label="Load current version"
          />
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

/** The second step of Save anyway: whose changes it replaces. */
function ConfirmStep({
  conflict,
  who,
  busy,
  run,
  setStep,
}: StepProps): JSX.Element {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {who ? `Replace ${who}'s changes?` : "Replace the newer changes?"}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {replacesSentence(conflict, who)} History records that you replaced
          them.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={() => setStep("choose")}
        >
          Back
        </Button>
        <AlertDialogAction
          variant="destructive"
          disabled={busy !== null}
          onClick={event => {
            event.preventDefault();
            run("overwrite");
          }}
        >
          <BusyLabel
            busy={busy === "overwrite"}
            doing="Saving..."
            label="Replace their changes"
          />
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

export function VersionConflictDialog({
  conflict,
  keepsRecoveryPoints,
  compareHref,
  onLoadCurrent,
  onSaveAnyway,
}: VersionConflictDialogProps): JSX.Element {
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [busy, setBusy] = useState<Busy>(null);
  // Closed by Keep editing; a later refusal is a new conflict, and opens it.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(false);
    setStep("choose");
  }, [conflict?.stale]);

  const open = conflict !== null && !dismissed;
  const changedBy = conflict?.stale.changedBy;
  const who = changedBy ? changerName(changedBy) : null;

  // The choice runs to its end with the dialog open, so its busy state is
  // seen; a failure stays in the dialog, said by `conflict.failure`.
  const run = (choice: "load" | "overwrite") => {
    setBusy(choice);
    void (choice === "load" ? onLoadCurrent() : onSaveAnyway())
      .catch(() => {})
      .finally(() => {
        setBusy(null);
        setStep("choose");
      });
  };

  const steps = { who, busy, run, setStep };
  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next && busy === null) setDismissed(true);
      }}
    >
      <AlertDialogContent>
        {conflict && step === "choose" ? (
          <ChooseStep
            conflict={conflict}
            {...steps}
            keepsRecoveryPoints={keepsRecoveryPoints}
            compareHref={compareHref}
          />
        ) : null}
        {conflict && step === "confirm" ? (
          <ConfirmStep conflict={conflict} {...steps} />
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
