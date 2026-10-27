"use client";

/**
 * MediaEditDialog Component
 *
 * Dialog for editing media metadata, opened from an upload field. For an
 * image it shows the whole image with the shared focus point control, which
 * saves the point itself on Done, the same way the library's details do;
 * "Save changes" saves the text. "Show image sizes" gates only the generated
 * image-size list. Folder is intentionally NOT editable here -- moving files
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
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Trash2,
  Download,
} from "@admin/components/icons";
import {
  copyableMediaUrl,
  formatFileSize,
  parseMediaSizes,
} from "@admin/lib/media-utils";
import { cn } from "@admin/lib/utils";
import type { Media, MediaUpdateInput } from "@admin/types/media";

import { isFocalPointKeyEvent, MediaFocalPoint } from "../MediaFocalPoint";

// ============================================================
// Schema
// ============================================================

const mediaEditSchema = z.object({
  altText: z
    .string()
    .max(500, "Alt text must be less than 500 characters")
    .optional()
    .nullable(),
  caption: z
    .string()
    .max(1000, "Caption must be less than 1000 characters")
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
// Image Sizes Display Component
// ============================================================

function ImageSizesDisplay({
  sizes,
}: {
  sizes: Record<
    string,
    { url: string; width: number; height: number; filesize: number }
  >;
}) {
  const [copiedUrl, setCopiedUrl] = React.useState<string | null>(null);

  const handleCopyUrl = React.useCallback((url: string, name: string) => {
    void navigator.clipboard.writeText(copyableMediaUrl(url));
    setCopiedUrl(name);
    setTimeout(() => setCopiedUrl(null), 2000);
  }, []);

  const entries = Object.entries(sizes);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">Image sizes</Label>
      <div className="rounded-md border border-input divide-y divide-border">
        {entries.map(([name, variant]) => (
          <div key={name} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="font-medium min-w-[80px]">{name}</span>
            <span className="text-muted-foreground">
              {variant.width} x {variant.height}
            </span>
            <span className="text-muted-foreground ml-auto">
              {formatFileSize(variant.filesize)}
            </span>
            <button
              type="button"
              onClick={() => handleCopyUrl(variant.url, name)}
              className="p-1 rounded-md hover:bg-accent transition-colors"
              title={`Copy ${name} URL`}
            >
              {copiedUrl === name ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
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
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

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
      setAdvancedOpen(false);
      setError(null);
    }
  }, [media, form]);

  // Handle form submission
  const handleSubmit = form.handleSubmit(async data => {
    if (isPending || !media) return;

    try {
      setIsSaving(true);
      setError(null);

      // Text only: the focus point saves itself from its own Done.
      const updates: MediaUpdateInput = {
        altText: data.altText || undefined,
        caption: data.caption || undefined,
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

  // Sizes may arrive as a JSON string from some adapters; one parser for both.
  const parsedSizes = React.useMemo(
    () => parseMediaSizes(media?.sizes),
    [media?.sizes]
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
            <div className={cn("flex gap-6", !isImage && "flex-col")}>
              {/* Left Panel - the whole image with its focus point. The
                  original, not the thumbnail, which is a square crop. */}
              {isImage && (
                <div className="w-full sm:w-[340px] flex-shrink-0">
                  <MediaFocalPoint
                    src={media.url}
                    alt={media.altText || media.originalFilename}
                    focalX={media.focalX}
                    focalY={media.focalY}
                    readOnly={isPending}
                    imageClassName="max-h-[300px]"
                    onSave={point => onSave(point)}
                  />
                </div>
              )}

              {/* Right Panel - Metadata Form + (advanced) Sizes */}
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

                {/* Advanced toggle (images only) -- gates only the image-sizes
                    list now; the focal-point picker is always visible above. */}
                {isImage &&
                  parsedSizes &&
                  Object.keys(parsedSizes).length > 0 && (
                    <div className="pt-2 space-y-3">
                      <button
                        type="button"
                        onClick={() => setAdvancedOpen(prev => !prev)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                        aria-expanded={advancedOpen}
                      >
                        {advancedOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        {advancedOpen ? "Hide image sizes" : "Show image sizes"}
                      </button>
                      {advancedOpen && (
                        <ImageSizesDisplay sizes={parsedSizes} />
                      )}
                    </div>
                  )}
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
