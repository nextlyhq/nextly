/**
 * Unpublish Confirm Dialog
 *
 * Two-step confirm before flipping a published entry back to draft. The
 * underlying mutation is the same one Save Draft / Publish use; this
 * dialog only gates the click. Built on shadcn AlertDialog primitives,
 * matching the BulkDeleteDialog pattern in the same area.
 *
 * — the entry leaves the public site immediately. Strapi and WordPress
 * both confirm; only Payload skips it (and Payload has open GitHub bugs
 * about misclick unpublishes). Misclick cost > confirm cost.
 *
 * @module components/features/entries/EntryForm/UnpublishConfirmDialog
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

export interface UnpublishConfirmDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler — fires on ESC, click-outside, Cancel. */
  onOpenChange: (open: boolean) => void;
  /** Display name for the entry being unpublished. Falls back to "this
   *  entry" when empty so the dialog never shows a bare "Unpublish ?". */
  entryLabel?: string | null;
  /** Confirm callback. The dialog itself does not close on confirm —
   *  the caller is responsible for closing on success/error so the
   *  loading state stays visible during the mutation. */
  onConfirm: () => void;
  /** Whether the unpublish mutation is in flight. */
  isLoading?: boolean;
}

export function UnpublishConfirmDialog({
  open,
  onOpenChange,
  entryLabel,
  onConfirm,
  isLoading = false,
}: UnpublishConfirmDialogProps) {
  const label = entryLabel?.trim() || "this entry";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unpublish {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove the entry from your public site immediately. You
            can republish it any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isLoading}
            className="bg-destructive-solid text-destructive-foreground hover:bg-destructive-700"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Unpublishing...
              </>
            ) : (
              "Unpublish"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
