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
  onConfirm: () => void;
  isRestoring?: boolean;
}

export function RestoreConfirmDialog({
  open,
  onOpenChange,
  versionNo,
  isPublished = false,
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
                Nothing is lost. The current content is kept as its own version,
                and restoring records a new one — so you can undo this by
                restoring again.
              </p>
              <p>
                Values that were never stored in a version, such as passwords,
                are left as they are.
              </p>
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
            disabled={isRestoring}
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
