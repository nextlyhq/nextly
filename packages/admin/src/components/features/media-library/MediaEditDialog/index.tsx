"use client";

/**
 * MediaEditDialog Component
 *
 * Dialog for editing media metadata, opened from an upload field. For an
 * image it shows the whole image with the shared focus point control. Here
 * Done only places the point: "Save changes" sends it with the text in one
 * `onSave`, as this exported dialog always has, so a caller whose handler
 * closes or submits runs once. Image sizes are no longer made, so none are
 * listed. Folder is intentionally NOT editable here -- moving files
 * between folders is its own dedicated dialog.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from "@nextlyhq/ui";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  Loader2,
  AlertTriangle,
  Copy,
  Trash2,
  Download,
} from "@admin/components/icons";
import {
  MEDIA_ALT_TEXT_MAX_LENGTH,
  MEDIA_CAPTION_MAX_LENGTH,
} from "@admin/constants/media";
import { formatFileSize, mediaImageSrc } from "@admin/lib/media-utils";
import { cn } from "@admin/lib/utils";
import type { Media, MediaUpdateInput } from "@admin/types/media";

import {
  isFocalPointKeyEvent,
  MediaFocalPoint,
  type MediaFocalPointValue,
} from "../MediaFocalPoint";

// ============================================================
// Schema
// ============================================================

const mediaEditSchema = z.object({
  altText: z
    .string()
    .max(
      MEDIA_ALT_TEXT_MAX_LENGTH,
      `Alt text can be at most ${MEDIA_ALT_TEXT_MAX_LENGTH} characters`
    )
    .optional()
    .nullable(),
  caption: z
    .string()
    .max(
      MEDIA_CAPTION_MAX_LENGTH,
      `Caption can be at most ${MEDIA_CAPTION_MAX_LENGTH} characters`
    )
    .optional()
    .nullable(),
});

type MediaEditFormData = z.infer<typeof mediaEditSchema>;

// ============================================================
// Props
// ============================================================

export interface MediaEditDialogProps {
  open: boolean;
  media: Media | null;
  onOpenChange: (open: boolean) => void;
  onSave: (updates: MediaUpdateInput) => Promise<void>;
  onDelete?: (media: Media) => void;
  onDownload?: (media: Media) => void;
  onCopyUrl?: (url: string) => void;
  isLoading?: boolean;
}

// ============================================================
// Main Dialog Component
// ============================================================

export function MediaEditDialog({
  open,
  media,
  onOpenChange,
  onSave,
  onDelete,
  onDownload,
  onCopyUrl,
  isLoading = false,
}: MediaEditDialogProps): React.JSX.Element | null {
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // The point as placed by Done, sent by "Save changes"; null until placed.
  const [focalDraft, setFocalDraft] =
    React.useState<MediaFocalPointValue | null>(null);

  const isPending = isSaving || isLoading;
  const isImage = media?.mimeType?.startsWith("image/") ?? false;

  // React Hook Form setup
  const form = useForm<MediaEditFormData>({
    resolver: zodResolver(mediaEditSchema),
    defaultValues: {
      altText: media?.altText || "",
      caption: media?.caption || "",
    },
  });

  // Reset form when media changes
  React.useEffect(() => {
    if (media) {
      form.reset({
        altText: media.altText || "",
        caption: media.caption || "",
      });
      setError(null);
      setFocalDraft(null);
    }
  }, [media, form]);

  // Handle form submission
  const handleSubmit = form.handleSubmit(async data => {
    if (isPending || !media) return;

    try {
      setIsSaving(true);
      setError(null);

      // The point goes only when Done moved it from the stored one, so a
      // save that didn't touch it leaves the stored point as it was.
      const pointMoved =
        focalDraft !== null &&
        (focalDraft.focalX !== (media.focalX ?? 50) ||
          focalDraft.focalY !== (media.focalY ?? 50));
      const updates: MediaUpdateInput = {
        altText: data.altText || undefined,
        caption: data.caption || undefined,
        ...(pointMoved ? focalDraft : {}),
      };

      await onSave(updates);

      toast.success("Media updated", {
        description: `Updated "${media.originalFilename}"`,
      });

      onOpenChange(false);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";
      setError(`Failed to update: ${errorMessage}`);
      toast.error("Error updating media", { description: errorMessage });
    } finally {
      setIsSaving(false);
    }
  });

  const handleFormSubmit = React.useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      e.stopPropagation();
      void handleSubmit();
    },
    [handleSubmit]
  );

  if (!media) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "p-0 gap-0 overflow-hidden",
          isImage ? "sm:max-w-4xl" : "sm:max-w-2xl"
        )}
        // Escape while placing the focus point stops placing it; the dialog
        // stays open.
        onEscapeKeyDown={event => {
          if (isFocalPointKeyEvent(event)) event.preventDefault();
        }}
      >
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>Edit media</DialogTitle>
          <DialogDescription className="sr-only">
            Edit the metadata for {media.originalFilename}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleFormSubmit}>
          <div className="px-6 pb-6">
            {/* An image stacks above the form on a narrow screen, where a row
                would squeeze the form beside a full-width image, and sits
                beside it from `sm` up. */}
            <div
              className={cn("flex flex-col gap-6", isImage && "sm:flex-row")}
            >
              {/* Left Panel - the whole image with its focus point. The
                  original, not the thumbnail, which is a square crop. */}
              {isImage && (
                <div className="w-full sm:w-[340px] flex-shrink-0">
                  <MediaFocalPoint
                    src={mediaImageSrc(media, { purpose: "preview" })}
                    alt={media.altText || media.originalFilename}
                    focalX={media.focalX}
                    focalY={media.focalY}
                    readOnly={isPending}
                    imageClassName="max-h-[300px]"
                    // Done places the point; "Save changes" sends it.
                    onSave={setFocalDraft}
                  />
                </div>
              )}

              {/* Right Panel - Metadata Form */}
              <div className="flex-1 space-y-4 min-w-0">
                {/* Filename */}
                <div className="pb-2 border-b border-border">
                  <div className="text-sm font-semibold break-all whitespace-normal text-foreground">
                    {media.originalFilename}
                  </div>
                </div>

                {/* Alt Text */}
                <div className="space-y-1.5">
                  <Label htmlFor="altText" className="text-sm font-medium">
                    Alt text
                    {isImage && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (recommended)
                      </span>
                    )}
                  </Label>
                  <Input
                    id="altText"
                    placeholder="Describe the image for screen readers..."
                    {...form.register("altText")}
                    maxLength={MEDIA_ALT_TEXT_MAX_LENGTH}
                    disabled={isPending}
                  />
                </div>

                {/* Caption */}
                <div className="space-y-1.5">
                  <Label htmlFor="caption" className="text-sm font-medium">
                    Caption
                  </Label>
                  <Input
                    id="caption"
                    placeholder="Optional caption or description..."
                    {...form.register("caption")}
                    maxLength={MEDIA_CAPTION_MAX_LENGTH}
                    disabled={isPending}
                  />
                </div>

                {/* File Info Row */}
                <div className="grid grid-cols-2 gap-6 pt-1">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">
                      File size
                    </div>
                    <div className="text-sm font-medium text-foreground">
                      {formatFileSize(media.size)}
                    </div>
                  </div>
                  {media.width && media.height && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">
                        Dimensions
                      </div>
                      <div className="text-sm font-medium text-foreground">
                        {media.width} &times; {media.height}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Error Alert */}
            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          {/* Footer - Action Buttons (Left) + Cancel/Save (Right) */}
          <div className="flex items-center justify-between gap-4 bg-muted/30 border-t border-border px-6 py-3">
            {/* Action Buttons Group (Left) */}
            <div className="flex items-center gap-1">
              {onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => media && onDelete(media)}
                  className="gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              )}
              {onCopyUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => media && onCopyUrl(media.url)}
                  className="gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-4 w-4" />
                  Copy URL
                </Button>
              )}
              {onDownload && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => media && onDownload(media)}
                  className="gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              )}
            </div>

            {/* Submit Group (Right) */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} className="gap-1.5">
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
