"use client";

/**
 * The Builder's pending changes, in its toolbar: how many there are, shown at
 * all times, Undo and Redo, and Discard all.
 *
 * Undo and Redo also answer to the platform's keys (Ctrl or Cmd with Z, and
 * Shift as well, or Y, to redo), but never while a text input has focus,
 * where those keys undo the text being typed. Each undo or redo is announced
 * in a live region mounted from the start, saying what it did. Discard all
 * asks first, naming how many changes go.
 *
 * A read-only entity has no edits to count or take back, so it shows none of
 * this.
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
import { type JSX, useState } from "react";

import { Redo, RotateCcw, Undo } from "@admin/components/icons";
import type { BuilderPendingChanges } from "@admin/hooks/useBuilderEntityState";
import { useKeyboardShortcuts } from "@admin/hooks/useKeyboardShortcuts";

type Props = {
  pending: BuilderPendingChanges;
  /** The number of pending changes, the entity's settings included. */
  count: number;
  locked?: boolean;
};

/**
 * Whether a modal dialog is open over the builder. While one is, the keys are
 * the dialog's: a confirmation shows a previewed set of changes, and an undo
 * behind it would change what is saved without the dialog showing it.
 */
function dialogOpen(): boolean {
  return (
    document.querySelector(
      '[role="alertdialog"], [role="dialog"][aria-modal="true"]'
    ) !== null
  );
}

/** "No unsaved changes", "1 unsaved change", "3 unsaved changes". */
function countWords(count: number): string {
  if (count === 0) return "No unsaved changes";
  return `${count} unsaved ${count === 1 ? "change" : "changes"}`;
}

/** "1 change", "3 changes": how many a discard throws away. */
function changesWords(count: number): string {
  return `${count} ${count === 1 ? "change" : "changes"}`;
}

export function PendingChangesControls({
  pending,
  count,
  locked = false,
}: Props): JSX.Element | null {
  const [announcement, setAnnouncement] = useState("");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // A message the same as the last one still changes the live region, by a
  // trailing space it alternates, or it would not be read again.
  const announce = (said: string) =>
    setAnnouncement(last => (last === said ? `${said}\u00a0` : said));
  const undo = () => {
    const said = pending.undo();
    if (said) announce(said);
  };
  const redo = () => {
    const said = pending.redo();
    if (said) announce(said);
  };

  const noDialog = () => !dialogOpen();
  // Not while typing: inside a text input these keys undo the text, which is
  // what a person typing expects them to do.
  useKeyboardShortcuts(
    [
      {
        key: "z",
        ctrl: true,
        action: undo,
        description: "Undo",
        when: noDialog,
      },
      {
        key: "z",
        ctrl: true,
        shift: true,
        action: redo,
        description: "Redo",
        when: noDialog,
      },
      {
        key: "y",
        ctrl: true,
        action: redo,
        description: "Redo",
        when: noDialog,
      },
    ],
    { name: "builder-pending-changes", enabled: !locked }
  );

  if (locked) return null;

  return (
    <div className="flex items-center gap-2">
      {/* On a phone the toolbar has no room for the words, so the number
          shows alone and the words are still read out. */}
      <span
        data-testid="pending-changes-count"
        className="sr-only sm:not-sr-only text-xs text-muted-foreground whitespace-nowrap"
      >
        {countWords(count)}
      </span>
      <span
        aria-hidden="true"
        className="sm:hidden text-xs tabular-nums text-muted-foreground"
      >
        {count}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Undo"
        title="Undo"
        disabled={!pending.canUndo}
        onClick={undo}
      >
        <Undo className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Redo"
        title="Redo"
        disabled={!pending.canRedo}
        onClick={redo}
      >
        <Redo className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Discard all changes"
        disabled={count === 0}
        onClick={() => setConfirmingDiscard(true)}
      >
        <RotateCcw className="h-4 w-4 sm:hidden" />
        <span className="hidden sm:inline">Discard all</span>
      </Button>

      <AlertDialog open={confirmingDiscard} onOpenChange={setConfirmingDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard {changesWords(count)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every change since the last save goes, and the fields and settings
              return to how they were saved. Nothing has reached the database,
              so nothing stored is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmingDiscard(false);
                pending.discardAll();
                announce(`Discarded ${changesWords(count)}`);
              }}
            >
              Discard {changesWords(count)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mounted from the start, and only its text changes: several screen
          readers skip a live region inserted together with its message. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
