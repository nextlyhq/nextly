"use client";

/**
 * MediaEditDialog Component
 *
 * Two-panel dialog for editing media metadata, setting crop point, and
 * viewing generated image sizes.
 *
 * Left panel: Image preview with crop point picker
 * Right panel: Metadata form (alt text, caption, tags, folder) + image sizes
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
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@revnixhq/ui";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  Copy,
  Check,
  Trash2,
  Download,
} from "@admin/components/icons";
import { useRootFolders } from "@admin/hooks/queries/useMedia";
import { formatFileSize } from "@admin/lib/media-utils";
import { cn } from "@admin/lib/utils";
import type { Media, MediaUpdateInput } from "@admin/types/media";

import { FolderTreePicker } from "../FolderTreePicker";

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
  tags: z
    .string()
    .max(500, "Tags must be less than 500 characters")
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
          "relative rounded-none overflow-hidden  border border-primary/5 cursor-crosshair",
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
          className="w-full h-auto max-h-[300px] object-contain bg-primary/5"
          draggable={false}
        />
        {/* Crosshair overlay */}
        <div
          className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${focalX}%`, top: `${focalY}%` }}
        >
          {/* Outer ring */}
          <div className="absolute inset-0 rounded-none border-2 border-white shadow-md" />
          {/* Inner dot */}
          <div className="absolute inset-[7px] rounded-none bg-white shadow-sm" />
          {/* Crosshair lines */}
          <div className="absolute top-1/2 left-0 w-full h-px bg-white/70 -translate-y-px" />
          <div className="absolute left-1/2 top-0 h-full w-px bg-white/70 -translate-x-px" />
        </div>
      </div>

      {/* Crop point label */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Click image to set crop point</span>
        <span className="font-mono">
          ({focalX}, {focalY})
        </span>
      </div>

      {/* Preview strip - shows how image crops at common ratios */}
      <div className="flex gap-4 pt-2">
        {[
          { label: "1:1", w: 56, h: 56 },
          { label: "16:9", w: 72, h: 40 },
          { label: "4:3", w: 64, h: 48 },
        ].map(({ label, w, h }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-1.5 group/ratio cursor-default"
          >
            <div
              className="rounded-none border-0 overflow-hidden bg-primary/5 transition-all duration-300 ring-0 group-hover/ratio:ring-2 group-hover/ratio:ring-primary/20"
              style={{ width: w, height: h }}
            >
              <img
                src={imageUrl}
                alt={`${label} crop preview`}
                className="w-full h-full object-cover transition-transform duration-500 group-hover/ratio:scale-110"
                style={{ objectPosition: `${focalX}% ${focalY}%` }}
                draggable={false}
              />
            </div>
            <span className="text-[9px] font-bold text-black dark:text-white uppercase tracking-widest leading-none">
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
      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Image Sizes
      </Label>
      <div className="rounded-none  border border-primary/5 divide-y divide-border">
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
                <Check className="h-3.5 w-3.5 text-green-500" />
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
  const [selectedFolderId, setSelectedFolderId] = React.useState<string | null>(
    media?.folderId ?? null
  );
  const [isFolderPickerOpen, setIsFolderPickerOpen] = React.useState(false);
  const [focalX, setFocalX] = React.useState(media?.focalX ?? 50);
  const [focalY, setFocalY] = React.useState(media?.focalY ?? 50);
  const { data: rootFolders } = useRootFolders();

  const isPending = isSaving || isLoading;
  const isImage = media?.mimeType?.startsWith("image/") ?? false;

  // React Hook Form setup
  const form = useForm<MediaEditFormData>({
    resolver: zodResolver(mediaEditSchema),
    defaultValues: {
      altText: media?.altText || "",
      caption: media?.caption || "",
      tags: Array.isArray(media?.tags) ? media?.tags.join(", ") : "",
    },
  });

  // Reset form when media changes
  React.useEffect(() => {
    if (media) {
      form.reset({
        altText: media.altText || "",
        caption: media.caption || "",
        tags: Array.isArray(media.tags) ? media.tags.join(", ") : "",
      });
      setSelectedFolderId(media.folderId ?? null);
      setFocalX(media.focalX ?? 50);
      setFocalY(media.focalY ?? 50);
      setIsFolderPickerOpen(false);
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

      const tags = data.tags
        ? data.tags
            .split(",")
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0)
        : undefined;

      // Check if crop point changed
      const cropPointChanged =
        focalX !== (media.focalX ?? 50) || focalY !== (media.focalY ?? 50);

      const updates: MediaUpdateInput = {
        altText: data.altText || undefined,
        caption: data.caption || undefined,
        tags: tags && tags.length > 0 ? tags : undefined,
        folderId: selectedFolderId,
        ...(cropPointChanged && isImage ? { focalX, focalY } : {}),
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
          "sm:max-w-4xl p-0 gap-0 overflow-hidden",
          !isImage && "sm:max-w-2xl"
        )}
      >
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>Edit Media</DialogTitle>
          <DialogDescription className="sr-only">
            Edit the metadata for {media.originalFilename}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleFormSubmit}>
          <div className="px-6 pb-6">
            <div className={cn("flex gap-6", !isImage && "flex-col")}>
              {/* Left Panel - Image Preview + Crop Point (images only) */}
              {isImage && (
                <div className="w-full sm:w-[340px] flex-shrink-0 space-y-3">
                  <CropPointPicker
                    imageUrl={media.thumbnailUrl || media.url}
                    focalX={focalX}
                    focalY={focalY}
                    onChange={handleCropPointChange}
                    disabled={isPending}
                  />
                </div>
              )}

              {/* Right Panel - Metadata Form + Sizes */}
              <div className="flex-1 space-y-4 min-w-0">
                {/* Filename */}
                <div className="pb-2  border-b border-primary/5">
                  <div className="text-sm font-semibold truncate text-foreground/90">
                    {media.originalFilename}
                  </div>
                </div>

                {/* Alt Text */}
                <div className="space-y-1.5">
                  <Label htmlFor="altText" className="text-sm">
                    Alt Text
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
                  <Label htmlFor="caption" className="text-sm">
                    Caption
                  </Label>
                  <Input
                    id="caption"
                    placeholder="Optional caption or description..."
                    {...form.register("caption")}
                    disabled={isPending}
                  />
                </div>

                {/* Tags */}
                <div className="space-y-1.5">
                  <Label htmlFor="tags" className="text-sm">
                    Tags
                    <span className="ml-1 text-xs text-muted-foreground">
                      (comma-separated)
                    </span>
                  </Label>
                  <Input
                    id="tags"
                    placeholder="e.g., logo, branding, header"
                    {...form.register("tags")}
                    disabled={isPending}
                  />
                </div>

                {/* Folder */}
                <div className="space-y-1.5">
                  <Label className="text-sm">Folder</Label>
                  <Popover
                    open={isFolderPickerOpen}
                    onOpenChange={setIsFolderPickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-none  border border-primary/5 bg-background px-3 py-2 text-sm transition-colors hover:bg-accent cursor-pointer"
                      >
                        <FolderIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 text-left truncate">
                          {selectedFolderId
                            ? rootFolders?.find(f => f.id === selectedFolderId)
                                ?.name ||
                              (media?.folderId === selectedFolderId
                                ? "Current Folder"
                                : "Selected folder")
                            : "Root (No Folder)"}
                        </span>
                        {isFolderPickerOpen ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="p-0 !w-[var(--radix-popover-trigger-width)] !max-w-none !max-h-[120px] overflow-hidden !shadow-none"
                      align="start"
                      sideOffset={4}
                      style={{
                        width: "var(--radix-popover-trigger-width)",
                        maxHeight: "120px",
                      }}
                      onOpenAutoFocus={e => e.preventDefault()}
                    >
                      <div
                        className="overflow-y-auto p-1"
                        style={{ maxHeight: "120px", minHeight: "80px" }}
                        onWheel={e => e.stopPropagation()}
                      >
                        <FolderTreePicker
                          selectedFolderId={selectedFolderId}
                          onSelect={folder => {
                            setSelectedFolderId(folder?.id ?? null);
                            setIsFolderPickerOpen(false);
                          }}
                          rootLabel="Root (No Folder)"
                          compact
                        />
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* File Info Row */}
                <div className="grid grid-cols-2 gap-6 pt-1">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-muted-foreground">
                      File Size
                    </div>
                    <div className="text-sm font-medium text-foreground/80">
                      {formatFileSize(media.size)}
                    </div>
                  </div>
                  {media.width && media.height && (
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-muted-foreground">
                        Dimensions
                      </div>
                      <div className="text-sm font-medium text-foreground/80">
                        {media.width} &times; {media.height}
                      </div>
                    </div>
                  )}
                </div>

                {/* Image Sizes (if available) */}
                {parsedSizes && Object.keys(parsedSizes).length > 0 && (
                  <ImageSizesDisplay sizes={parsedSizes} />
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

          {/* Footer - Full-Width Unified Background */}
          <div className="mt-2 flex items-center justify-between gap-4 bg-primary/5  border-t border-primary/5 px-6 py-4">
            {/* Action Buttons Group (Left) */}
            <div className="flex items-center gap-2">
              {onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => media && onDelete(media)}
                  className="px-3 text-muted-foreground/70 hover:text-primary hover:bg-primary/5 transition-all duration-200"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="text-xs font-semibold tracking-tight">
                    Delete
                  </span>
                </Button>
              )}
              {onCopyUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => media && onCopyUrl(media.url)}
                  className="px-3 text-muted-foreground/70 hover:text-primary hover:bg-primary/5 transition-all duration-200"
                >
                  <Copy className="h-4 w-4" />
                  <span className="text-xs font-semibold tracking-tight">
                    Copy URL
                  </span>
                </Button>
              )}
              {onDownload && (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => media && onDownload(media)}
                  className="px-3 text-muted-foreground/70 hover:text-primary hover:bg-primary/5 transition-all duration-200"
                >
                  <Download className="h-4 w-4" />
                  <span className="text-xs font-semibold tracking-tight">
                    Download
                  </span>
                </Button>
              )}
            </div>

            {/* Submit Group (Right) */}
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
                className="px-4 text-xs font-semibold tracking-tight bg-card border-primary/5"
              >
                Cancel
              </Button>
              <Button
                size="md"
                type="submit"
                disabled={isPending}
                className="px-6 bg-primary text-primary-foreground text-xs font-semibold tracking-tight hover:opacity-90 shadow-sm"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
