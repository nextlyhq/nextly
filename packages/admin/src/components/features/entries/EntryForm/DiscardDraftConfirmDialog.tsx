/**
 * Discard Draft Confirm Dialog
 *
 * Two-step confirm before throwing away a published entry's pending working
 * draft (the draft/published split). Unlike "Discard changes", which only drops
 * unsaved edits from the current session, this deletes edits already saved as a
 * working draft, so the confirm guards a genuinely destructive, irreversible
 * action. The live published row is untouched either way. Built on the same
 * AlertDialog primitives as UnpublishConfirmDialog.
 *
 * @module components/features/entries/EntryForm/DiscardDraftConfirmDialog
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

import { Loader2 } from "@admin/components/icons";

export interface DiscardDraftConfirmDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler — fires on ESC, click-outside, Cancel. */
  onOpenChange: (open: boolean) => void;
  /** Display name for the entry. Falls back to "this entry" when empty. */
  entryLabel?: string | null;
  /** Confirm callback. The dialog does not close itself on confirm — the caller
   *  closes it once the discard settles so the loading state stays visible
   *  meanwhile. May be async; its promise is awaited by the caller. */
  onConfirm: () => void | Promise<void>;
  /** Whether the discard mutation is in flight. */
  isLoading?: boolean;
}

export function DiscardDraftConfirmDialog({
  open,
  onOpenChange,
  entryLabel,
  onConfirm,
  isLoading = false,
}: DiscardDraftConfirmDialogProps) {
  const label = entryLabel?.trim() || "this entry";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard draft for {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the unpublished changes and restores the
            editor to the published version. The published version stays live.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            // Prevent Radix from auto-closing on click: the caller keeps the
            // dialog open until the discard settles so this button's in-flight
            // spinner and the disabled controls are actually visible meanwhile.
            onClick={event => {
              event.preventDefault();
              void onConfirm();
            }}
            disabled={isLoading}
            className="bg-destructive-solid text-destructive-foreground hover:bg-destructive-600"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Discarding...
              </>
            ) : (
              "Discard draft"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
