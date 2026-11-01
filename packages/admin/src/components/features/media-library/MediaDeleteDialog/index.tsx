"use client";

/**
 * MediaDeleteDialog Component
 *
 * Asks before one media item is deleted, saying first where it is used (the
 * documents the reader may open, and how many more), since each of them
 * will show no image until another is chosen. The delete can be undone for a
 * few seconds afterwards, and the dialog says so. The library makes the
 * request and offers the Undo.
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
} from "@nextlyhq/ui";
import { useState, useCallback, useRef } from "react";
import type { JSX } from "react";

import { Loader2, AlertTriangle } from "@admin/components/icons";
import type { Media } from "@admin/types/media";

import type { MediaUsage } from "../media-library-api";
import { useMediaUsage } from "../media-library-queries";
import { MediaUsageList, placesText, usageTotal } from "../MediaUsedIn";

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
 * What the dialog says first: where the item is used, or that it isn't. It
 * says it isn't only once the usage record is built: before then a use the
 * record lacks may still be in older content.
 */
function usageSentence(usage: MediaUsage | undefined, failed: boolean): string {
  if (usage) {
    const total = usageTotal(usage);
    if (total > 0) {
      return `It's used in ${placesText(total)}, which will show no image until you choose another.`;
    }
    return usage.usageRecorded
      ? "It isn't used anywhere."
      : "The usage record is still being built, so this may still be used.";
  }
  return failed
    ? "Couldn't check where it's used."
    : "Checking where it's used…";
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
}: MediaDeleteDialogProps): JSX.Element | null {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  const isPending = isDeleting || isLoading;
  // Asked only while the dialog is open, for the item it is about.
  const usage = useMediaUsage(open && media ? media.id : null);

  const handleConfirm = useCallback(async () => {
    if (isPending || !media) return;

    try {
      setIsDeleting(true);
      setError(null);

      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";
      setError(`Couldn't delete it: ${errorMessage}`);
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
            Delete {media.originalFilename}?
          </DialogTitle>
          <DialogDescription id="delete-media-dialog-description">
            {usageSentence(usage.data, usage.isError)} You can undo this for a
            few seconds.
          </DialogDescription>
        </DialogHeader>

        {usage.data && usageTotal(usage.data) > 0 && (
          <div className="max-h-56 overflow-y-auto rounded-md border border-border px-3 py-1">
            <MediaUsageList usage={usage.data} more={usage.more} />
          </div>
        )}

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
            onClick={() => {
              void handleConfirm();
            }}
            disabled={isPending}
            ref={deleteButtonRef}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
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
