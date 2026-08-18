"use client";

/**
 * CopyFromLanguageDialog — the confirm step of copy-from-language, rendered by
 * whichever surface triggered it.
 *
 * The dialog is its own component (rather than living inside one trigger)
 * because two surfaces offer the action and the warning must read identically
 * from both: what gets overwritten, what is untouched, and that nothing is
 * saved until the form is.
 *
 * @module components/features/entries/CopyFromLanguageDialog
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
} from "@nextlyhq/ui";

import type { CopyFromLanguage } from "./useCopyFromLanguage";

export function CopyFromLanguageDialog({ copy }: { copy: CopyFromLanguage }) {
  const { pending, pendingLabel, activeLabel, busy } = copy;
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={open => {
        if (!open) copy.cancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Copy from {pendingLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            This fills {activeLabel}&rsquo;s translatable fields with{" "}
            {pendingLabel}&rsquo;s values, overwriting anything already entered
            for {activeLabel}. Shared fields are untouched. Nothing is saved
            until you save the form, so you can review or discard first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={e => {
              e.preventDefault();
              void copy.confirm();
            }}
          >
            {busy ? "Copying…" : `Copy from ${pendingLabel}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
