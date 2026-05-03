"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Label,
} from "@revnixhq/ui";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";

import { toast } from "@admin/components/ui";
import { FormLabelWithTooltip } from "@admin/components/ui/form-label-with-tooltip";
import { UI } from "@admin/constants/ui";
import { useGeneralSettings } from "@admin/hooks/queries/useGeneralSettings";
import { useDeleteMedia, useUpdateMedia } from "@admin/hooks/queries/useMedia";
import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";
import { formatFileSize } from "@admin/lib/media-utils";
import type { Media } from "@admin/types/media";

interface MediaDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  media: Media | null;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
}

export function MediaDetailDialog({
  open,
  onOpenChange,
  media,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
}: MediaDetailDialogProps) {
  const [altText, setAltText] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [caption, setCaption] = React.useState("");
  const [isCopied, setIsCopied] = React.useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const { formatDate } = useAdminDateFormatter();
  const { data: settings } = useGeneralSettings();
  const mediaTimezone = settings?.timezone ?? "UTC";

  const { mutate: updateMedia } = useUpdateMedia();
  const { mutate: deleteMedia, isPending: isDeleting } = useDeleteMedia();

  // Reset form when media changes
  React.useEffect(() => {
    if (media) {
      setAltText(media.altText || "");
      setTitle(media.filename || "");
      setCaption(media.caption || "");
    }
  }, [media]);

  // Handle save on blur
  const handleSave = () => {
    if (!media) return;

    if (
      altText === (media.altText || "") &&
      title === (media.filename || "") &&
      caption === (media.caption || "")
    ) {
      return;
    }

    updateMedia(
      {
        mediaId: media.id,
        updates: {
          altText,
          filename: title,
          caption,
        },
      },
      {
        onSuccess: () => {
          toast.success("Media details updated");
        },
        onError: () => {
          toast.error("Failed to update media details");
        },
      }
    );
  };

  const handleCopyUrl = async () => {
    if (!media?.url) return;
    try {
      await navigator.clipboard.writeText(media.url);
      setIsCopied(true);
      toast.success("URL copied to clipboard");
      setTimeout(() => setIsCopied(false), UI.COPY_FEEDBACK_TIMEOUT_MS);
    } catch {
      toast.error("Failed to copy URL");
    }
  };

  const handleDeleteClick = () => {
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!media) return;
    deleteMedia(media.id, {
      onSuccess: () => {
        toast.success("Media deleted successfully");
        setIsDeleteDialogOpen(false);
        onOpenChange(false);
      },
      onError: () => {
        toast.error("Failed to delete media");
        setIsDeleteDialogOpen(false);
      },
    });
  };

  const handleDownload = async () => {
    if (!media?.url) return;
    try {
      const response = await fetch(media.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = media.originalFilename || media.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed:", e);
      window.open(media.url, "_blank");
    }
  };

  if (!media) return null;

  const type = media.mimeType.split("/")[0];
  const isImage = type === "image";
  const isVideo = type === "video";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-7xl w-full h-[80vh] p-0 flex flex-col gap-0 overflow-hidden bg-background shadow-2xl  border border-primary/5 sm:rounded-none">
          {/* 1. Header Row (Fixed Height) */}
          <div className="h-16  border-b border-primary/5 flex items-center justify-between px-6 bg-background shrink-0 z-10 w-full relative">
            <div className="flex items-center gap-2">
              <DialogTitle className="text-xl font-bold tracking-tight">
                Attachment Details
              </DialogTitle>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-none shadow-none hover-unified text-primary/80 border-primary/5"
                onClick={onPrevious}
                disabled={!hasPrevious}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-none shadow-none hover-unified text-primary/80 border-primary/5"
                onClick={onNext}
                disabled={!hasNext}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-none shadow-none hover:bg-destructive/10 hover:text-destructive text-muted-foreground border-primary/5"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 2. Main Body (Row Layout) - Explicit Flex Row */}
          <div className="flex-1 flex flex-row overflow-hidden min-h-0 bg-background w-full">
            {/* LEFT: Preview Area (Fixed 65% Width) */}
            <div
              className="flex-[0_0_65%] bg-primary/5 flex flex-col relative overflow-hidden h-full"
              style={{ width: "65%", minWidth: "65%" }}
            >
              {/* Image Container: Center the image */}
              <div className="flex-1 w-full h-full flex items-center justify-center p-10 overflow-hidden">
                {isImage ? (
                  <div className="relative w-full h-full flex items-center justify-center">
                    <img
                      src={media.url}
                      alt={media.altText || media.filename}
                      className="max-w-full max-h-full object-contain rounded-none transition-opacity duration-300"
                      style={{ maxWidth: "100%", maxHeight: "100%" }}
                    />
                  </div>
                ) : isVideo ? (
                  <video
                    src={media.url}
                    controls
                    className="max-w-full max-h-full shadow-lg rounded-none"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground p-12 border-2 border-dashed rounded-none bg-background/80 shadow-sm">
                    <FileText className="h-20 w-20 opacity-20" />
                    <div className="text-center">
                      <p className="font-medium text-foreground">
                        No preview available
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {media.mimeType}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: Sidebar (Fixed 35% Width) */}
            <div
              className="flex-[0_0_35%] bg-background flex flex-col overflow-hidden h-full min-w-[320px]  border-l border-primary/5"
              style={{ width: "35%", minWidth: "35%" }}
            >
              {/* Fixed Scrollable Area */}
              <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-thin">
                {/* Metadata Grid - Compact 2-column look */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[11px] text-muted-foreground  border-b border-primary/5 pb-4 mb-4">
                  <div className="space-y-1 overflow-hidden">
                    <span className="font-bold text-foreground/80 block uppercase tracking-wider text-[10px]">
                      Uploaded on
                    </span>
                    <span className="text-foreground block truncate font-medium">
                      {formatDate(media.uploadedAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: mediaTimezone,
                      })}
                    </span>
                  </div>

                  <div className="space-y-1 overflow-hidden">
                    <span className="font-bold text-foreground/80 block uppercase tracking-wider text-[10px]">
                      Updated on
                    </span>
                    <span className="text-foreground block truncate font-medium">
                      {formatDate(media.updatedAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: mediaTimezone,
                      })}
                    </span>
                  </div>

                  <div className="space-y-1 overflow-hidden">
                    <span className="font-bold text-foreground/80 block uppercase tracking-wider text-[10px]">
                      Uploaded by
                    </span>
                    <span
                      className="text-primary truncate block hover:underline cursor-pointer font-medium"
                      title={media.uploadedBy ?? "System"}
                    >
                      {media.uploadedBy ?? "System"}
                    </span>
                  </div>

                  <div className="space-y-1 overflow-hidden">
                    <span className="font-bold text-foreground/80 block uppercase tracking-wider text-[10px]">
                      File name
                    </span>
                    <span
                      className="text-foreground truncate font-mono select-all block font-medium"
                      title={media.originalFilename}
                    >
                      {media.originalFilename}
                    </span>
                  </div>

                  <div className="space-y-1 overflow-hidden">
                    <span className="font-bold text-foreground/80 block uppercase tracking-wider text-[10px]">
                      File type
                    </span>
                    <span className="uppercase font-medium block truncate text-foreground">
                      {media.mimeType}
                    </span>
                  </div>

                  <div className="space-y-1 overflow-hidden">
                    <span className="font-bold text-foreground/80 block uppercase tracking-wider text-[10px]">
                      File size
                    </span>
                    <span className="font-medium block truncate text-foreground">
                      {formatFileSize(media.size)}
                    </span>
                  </div>

                  {media.width && media.height && (
                    <div className="space-y-1 overflow-hidden">
                      <span className="font-bold text-foreground/80 block uppercase tracking-wider text-[10px]">
                        Dimensions
                      </span>
                      <span className="font-medium block truncate text-foreground">
                        {media.width} x {media.height}
                      </span>
                    </div>
                  )}
                </div>

                {/* Form Fields Section - Elegant spacing */}
                <div className="space-y-6">
                  <div className="space-y-2.5">
                    <FormLabelWithTooltip
                      htmlFor="alt-text"
                      className="mb-2"
                      labelClassName="text-[10px] font-bold text-foreground/70 uppercase tracking-wider block"
                      tooltipClassName="text-[10px]"
                      label="Alternative Text"
                      description="Leave empty if purely decorative."
                    />
                    <Input
                      id="alt-text"
                      value={altText}
                      onChange={e => setAltText(e.target.value)}
                      onBlur={handleSave}
                      className="h-10 text-xs focus-visible:ring-1 bg-primary/5 hover-unified transition-colors"
                      placeholder="Describe the image..."
                    />
                  </div>

                  <div className="space-y-2.5">
                    <Label
                      htmlFor="title"
                      className="text-[10px] font-bold text-foreground/70 uppercase tracking-wider block mb-2"
                    >
                      Title
                    </Label>
                    <Input
                      id="title"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      onBlur={handleSave}
                      className="h-10 text-xs focus-visible:ring-1 bg-primary/5 hover-unified transition-colors"
                    />
                  </div>

                  <div className="space-y-2.5 pb-2">
                    <Label
                      htmlFor="file-url"
                      className="text-[10px] font-bold text-foreground/70 uppercase tracking-wider block mb-2"
                    >
                      File URL
                    </Label>
                    <div className="flex gap-3">
                      <Input
                        id="file-url"
                        value={media.url}
                        readOnly
                        className="h-10 text-[10px] font-mono bg-primary/5 text-muted-foreground"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        className="h-10 px-4 shrink-0 text-xs font-semibold"
                        onClick={() => { void handleCopyUrl(); }}
                      >
                        {isCopied ? (
                          <Check className="h-3.5 w-3.5 text-green-500 mr-2" />
                        ) : null}
                        {isCopied ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Actions - Premium Spacing */}
              <div className="px-6 h-16  border-t border-primary/5 text-xs flex items-center justify-between shrink-0 bg-primary/5 mt-auto">
                <a
                  href={media.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline font-medium inline-flex items-center gap-1.5 transition-colors"
                >
                  View file <ExternalLink className="h-3 w-3 opacity-50" />
                </a>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => { void handleDownload(); }}
                    className="h-8 text-xs font-semibold gap-2 border-primary/5 hover-unified"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>

                  <Button
                    variant="destructive"
                    size="md"
                    onClick={handleDeleteClick}
                    className="h-8 text-xs font-semibold gap-2 hover:bg-destructive/90"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Media?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">
                &quot;{media.filename}&quot;
              </span>
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete Media"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
