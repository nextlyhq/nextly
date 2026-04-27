"use client";

/**
 * MediaDeleteDialog Component
 *
 * Confirmation dialog for deleting a single media file.
 * Displays media details and handles the deletion process with error handling.
 *
 * ## Features
 *
 * - **Confirmation UI**: Shows media filename before deletion
 * - **Error Handling**: Displays errors with retry option
 * - **Loading States**: Shows spinner during deletion
 * - **Accessibility**: WCAG 2.2 AA compliant with proper ARIA attributes
 *
 * ## Usage
 *
 * ```tsx
 * const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
 * const [mediaToDelete, setMediaToDelete] = useState<Media | null>(null);
 * const { mutate: deleteMedia, isPending } = useDeleteMedia();
 *
 * <MediaDeleteDialog
 *   open={deleteDialogOpen}
 *   media={mediaToDelete}
 *   onOpenChange={setDeleteDialogOpen}
 *   onConfirm={() => deleteMedia(mediaToDelete.id)}
 *   isLoading={isPending}
 * />
 * ```
 */

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@revnixhq/ui";
import { useState, useCallback, useRef } from "react";

import { Loader2, AlertTriangle } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import type { Media } from "@admin/types/media";

/**
 * MediaDeleteDialog component props
 */
export interface MediaDeleteDialogProps {
  /**
   * Whether the dialog is open
   */
  open: boolean;

  /**
   * Media item to delete
   */
  media: Media | null;

  /**
   * Callback when dialog open state changes
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Callback when delete is confirmed
   * Parent should handle the actual API call.
   *
   * @returns Promise that resolves when deletion completes
   */
  onConfirm: () => Promise<void>;

  /**
   * Whether delete operation is in progress (controlled loading state)
   *
   * @default false
   */
  isLoading?: boolean;
}

/**
 * MediaDeleteDialog component
 *
 * Confirmation dialog for deleting a single media file.
 */
export function MediaDeleteDialog({
  open,
  media,
  onOpenChange,
  onConfirm,
  isLoading = false,
}: MediaDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  const isPending = isDeleting || isLoading;

  const handleConfirm = useCallback(async () => {
    if (isPending || !media) return;

    try {
      setIsDeleting(true);
      setError(null);

      await onConfirm();

      toast.success("Media deleted successfully", {
        description: `"${media.filename}" has been removed.`,
      });

      onOpenChange(false);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";
      setError(`Failed to delete media: ${errorMessage}`);
      toast.error("Error deleting media", { description: errorMessage });
    } finally {
      setIsDeleting(false);
    }
  }, [onConfirm, isPending, onOpenChange, media]);

  // Reset error when dialog opens/closes
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setError(null);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange]
  );

  if (!media) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="delete-media-dialog-description"
        role="alertdialog"
      >
        <DialogHeader>
          <DialogTitle id="delete-media-dialog-title">
            Delete Media?
          </DialogTitle>
          <DialogDescription id="delete-media-dialog-description">
            Are you sure you want to delete <strong>{media.filename}</strong>?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => { void handleConfirm(); }}
            disabled={isPending}
            ref={deleteButtonRef}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
