"use client";

/**
 * MediaEditDialog Component
 *
 * Dialog for editing media metadata. For image media the focal-point picker
 * (image preview + ratio previews) is always visible; "Edit advanced options"
 * gates only the generated image-size list (URLs to copy, file sizes). Folder
 * is intentionally NOT editable here -- moving files between folders is its
 * own dedicated dialog (one click in the bulk action bar or per-item menu).
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
import { formatFileSize } from "@admin/lib/media-utils";
import { cn } from "@admin/lib/utils";
import type { Media, MediaUpdateInput } from "@admin/types/media";

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
// Crop Point Picker Component
// ============================================================

function CropPointPicker({
  imageUrl,
  focalX,
  focalY,
  onChange,
  disabled,
}: {
  imageUrl: string;
  focalX: number;
  focalY: number;
  onChange: (x: number, y: number) => void;
  disabled?: boolean;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Handle click on image to set crop point
  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
      // Clamp to 0-100
      onChange(Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y)));
    },
    [onChange, disabled]
  );

  return (
    <div className="space-y-3">
      {/* Image with crop point overlay */}
      <div
        ref={containerRef}
        className={cn(
          "relative rounded-none overflow-hidden border border-input bg-muted/30 cursor-crosshair",
          disabled && "cursor-not-allowed opacity-60"
        )}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-label={`Set crop point. Current position: ${focalX}%, ${focalY}%`}
      >
        <img
          src={imageUrl}
          alt="Preview"
          className="w-full h-auto max-h-[300px] object-contain"
          draggable={false}
        />
        {/* Crosshair overlay */}
        <div
          className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${focalX}%`, top: `${focalY}%` }}
        >
          {/* Outer ring */}
          <div className="absolute inset-0 rounded-full border-2 border-background shadow-md" />
          {/* Inner dot */}
          <div className="absolute inset-[7px] rounded-full bg-background shadow-sm" />
          {/* Crosshair lines */}
          <div className="absolute top-1/2 left-0 w-full h-px bg-background/70 -translate-y-px" />
          <div className="absolute left-1/2 top-0 h-full w-px bg-background/70 -translate-x-px" />
        </div>
      </div>

      {/* Crop point label */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Click image to set the focal point</span>
        <span className="font-mono">
          ({focalX}, {focalY})
        </span>
      </div>

      {/* Preview strip: shows how the image renders at common aspect ratios
          with the current focal point. Informational, not interactive. */}
      <div className="flex gap-4 pt-1">
        {[
          { label: "1:1", w: 56, h: 56 },
          { label: "16:9", w: 72, h: 40 },
          { label: "4:3", w: 64, h: 48 },
        ].map(({ label, w, h }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-1.5"
            aria-label={`Preview at ${label} aspect ratio`}
          >
            <div
              className="rounded-none border border-input overflow-hidden bg-muted/30"
              style={{ width: w, height: h }}
            >
              <img
                src={imageUrl}
                alt={`${label} crop preview`}
                className="w-full h-full object-cover"
                style={{ objectPosition: `${focalX}% ${focalY}%` }}
                draggable={false}
              />
            </div>
            <span className="text-xs font-medium text-muted-foreground leading-none">
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
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
    void navigator.clipboard.writeText(url);
    setCopiedUrl(name);
    setTimeout(() => setCopiedUrl(null), 2000);
  }, []);

  const entries = Object.entries(sizes);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">Image sizes</Label>
      <div className="rounded-none border border-input divide-y divide-border">
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
              className="p-1 rounded-none hover:bg-accent transition-colors"
              title={`Copy ${name} URL`}
            >
              {copiedUrl === name ? (
                <Check className="h-3.5 w-3.5 text-success-500" />
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
}: MediaEditDialogProps) {
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [focalX, setFocalX] = React.useState(media?.focalX ?? 50);
  const [focalY, setFocalY] = React.useState(media?.focalY ?? 50);
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
      setFocalX(media.focalX ?? 50);
      setFocalY(media.focalY ?? 50);
      setAdvancedOpen(false);
      setError(null);
    }
  }, [media, form]);

  // Handle crop point change
  const handleCropPointChange = React.useCallback((x: number, y: number) => {
    setFocalX(x);
    setFocalY(y);
  }, []);

  // Handle form submission
  const handleSubmit = form.handleSubmit(async data => {
    if (isPending || !media) return;

    try {
      setIsSaving(true);
      setError(null);

      // Only include focal point in the payload when the user actually moved
      // the crop point. The picker is now always visible for images, so the
      // user can intentionally set a focal point on first open without
      // accidentally overwriting the saved value.
      const cropPointChanged =
        isImage &&
        (focalX !== (media.focalX ?? 50) || focalY !== (media.focalY ?? 50));

      const updates: MediaUpdateInput = {
        altText: data.altText || undefined,
        caption: data.caption || undefined,
        ...(cropPointChanged ? { focalX, focalY } : {}),
      };

      await onSave(updates);

      toast.success("Media updated", {
        description: cropPointChanged
          ? "Metadata and crop point saved. Image sizes will be regenerated."
          : `Updated "${media.originalFilename}"`,
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

  // Parse sizes if they exist (might be a JSON string from some DB adapters)
  const parsedSizes = React.useMemo(() => {
    if (!media?.sizes) return null;
    if (typeof media.sizes === "object") return media.sizes;
    try {
      return JSON.parse(media.sizes);
    } catch (e) {
      console.error("Failed to parse media sizes:", e);
      return null;
    }
  }, [media?.sizes]);

  if (!media) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "p-0 gap-0 overflow-hidden",
          isImage ? "sm:max-w-4xl" : "sm:max-w-2xl"
        )}
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
              {/* Left Panel - Image Preview + Focal Point (always for images) */}
              {isImage && (
                <div className="w-full sm:w-[340px] flex-shrink-0">
                  <CropPointPicker
                    imageUrl={media.thumbnailUrl || media.url}
                    focalX={focalX}
                    focalY={focalY}
                    onChange={handleCropPointChange}
                    disabled={isPending}
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
