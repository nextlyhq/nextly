/**
 * Confirm before putting a document back to an earlier version.
 *
 * Restore writes the live document immediately, so it is gated the same way
 * unpublishing is. The wording does two jobs the obvious phrasing does not:
 * it says the change is recoverable, because history is never rewritten and a
 * wrong restore is undone by restoring again; and it says restore is not a
 * byte-for-byte rollback, because a stored version omits values that were
 * never captured — passwords among them — and a merge leaves those as they are.
 *
 * @module components/features/versions/RestoreConfirmDialog
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

export interface RestoreConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionNo: number;
  /** Whether this document is published, which decides how urgent this is. */
  isPublished?: boolean;
  /**
   * Whether the editor behind this restore holds unsaved changes. Restoring
   * replaces the live document, and the refresh that follows discards that
   * work — an author must be told before confirming, not discover it after.
   */
  unsavedChanges?: boolean;
  /**
   * A transient reason the confirm action is disabled — a refusal that
   * arrived after the dialog opened. The action stays visible so the
   * refusal's reason is still on screen behind it, but cannot be fired.
   */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  isRestoring?: boolean;
}

export function RestoreConfirmDialog({
  open,
  onOpenChange,
  versionNo,
  isPublished = false,
  unsavedChanges = false,
  confirmDisabled = false,
  onConfirm,
  isRestoring = false,
}: RestoreConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore version {versionNo}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                This replaces the document&apos;s current content with what it
                held at version {versionNo}
                {isPublished ? ", and the document is published" : ""}.
              </p>
              <p>
                {unsavedChanges
                  ? "Nothing already saved is lost. The current saved content is kept as its own version, and restoring records a new one — so you can undo this by restoring again."
                  : "Nothing is lost. The current content is kept as its own version, and restoring records a new one — so you can undo this by restoring again."}
              </p>
              <p>
                Values that were never stored in a version, such as passwords,
                are left as they are.
              </p>
              {unsavedChanges ? (
                <p className="font-medium text-foreground">
                  The editor has unsaved changes that this restore will discard.
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRestoring}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={event => {
              // The dialog stays open while the write is in flight so the
              // loading state is visible; the caller closes it on settle.
              event.preventDefault();
              onConfirm();
            }}
            disabled={isRestoring || confirmDisabled}
          >
            {isRestoring ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Restoring…
              </>
            ) : (
              `Restore version ${versionNo}`
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
