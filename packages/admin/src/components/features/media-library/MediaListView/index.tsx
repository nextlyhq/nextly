"use client";

/**
 * MediaListView Component
 *
 * Table-based list view for the Media Library. Shows media files in rows
 * with sortable columns: thumbnail, filename, type, size, dimensions, date.
 *
 * Shares the same props as MediaGrid so the parent can swap between views.
 */

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
} from "@revnixhq/ui";

import {
  AlertTriangle,
  Folder,
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  File,
} from "@admin/components/icons";
import { DEFAULT_MEDIA_SKELETON_COUNT } from "@admin/constants/media";
import { formatFileSize, getMediaType } from "@admin/lib/media-utils";
import { cn } from "@admin/lib/utils";
import type { Media } from "@admin/types/media";

// Re-use the same props interface as MediaGrid for easy swap
interface MediaListViewProps {
  media: Media[];
  isLoading?: boolean;
  error?: Error | null;
  selectedIds?: Set<string>;
  onSelectionChange?: (id: string) => void;
  onItemClick?: (media: Media) => void;
  onEdit?: (media: Media) => void;
  onDelete?: (media: Media) => void;
  onCopyUrl?: (url: string) => void;
  onDownload?: (media: Media) => void;
  onRetry?: () => void;
  className?: string;
  emptyStateMessage?: React.ReactNode;
}

// Get the right icon for a media type
function MediaTypeIcon({ mimeType }: { mimeType: string }) {
  const type = getMediaType(mimeType);
  switch (type) {
    case "image":
      return <FileImage className="h-4 w-4 text-blue-500" />;
    case "video":
      return <FileVideo className="h-4 w-4 text-purple-500" />;
    case "audio":
      return <FileAudio className="h-4 w-4 text-green-500" />;
    case "document":
      return <FileText className="h-4 w-4 text-orange-500" />;
    default:
      return <File className="h-4 w-4 text-muted-foreground" />;
  }
}

// Format dimensions string
function formatDimensions(
  width?: number | null,
  height?: number | null
): string {
  if (width && height) return `${width} x ${height}`;
  return "-";
}

// Format date for display
function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function MediaListView({
  media,
  isLoading = false,
  error = null,
  selectedIds = new Set(),
  onSelectionChange,
  onItemClick,
  onEdit,
  onDelete,
  onRetry,
  className = "",
  emptyStateMessage,
}: MediaListViewProps) {
  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn("space-y-2", className)}
        aria-busy="true"
        aria-label="Loading media files"
      >
        {Array.from({ length: DEFAULT_MEDIA_SKELETON_COUNT }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 p-3 rounded-md border border-border animate-pulse"
          >
            <div className="w-10 h-10 rounded bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-48 bg-muted rounded" />
              <div className="h-3 w-24 bg-muted rounded" />
            </div>
            <div className="h-3 w-16 bg-muted rounded" />
            <div className="h-3 w-20 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  // Error state (same as MediaGrid for consistency)
  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Failed to load media files</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <p>
            {error.message || "An error occurred while fetching media files."}
          </p>
          {onRetry && (
            <div>
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  // Empty state (same as MediaGrid for consistency)
  if (!media || media.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-8 px-4 text-center"
        role="status"
        aria-label="No media files"
      >
        <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center mb-4">
          <Folder className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          No media files found
        </h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {emptyStateMessage ??
            "Upload new media files using the upload area above to get started."}
        </p>
      </div>
    );
  }

  // Table header
  const columns = [
    { key: "select", label: "", width: "w-10" },
    { key: "preview", label: "", width: "w-12" },
    { key: "name", label: "Name", width: "flex-1" },
    { key: "type", label: "Type", width: "w-24" },
    { key: "size", label: "Size", width: "w-20" },
    {
      key: "dimensions",
      label: "Dimensions",
      width: "w-28 hidden md:table-cell",
    },
    { key: "date", label: "Uploaded", width: "w-28 hidden lg:table-cell" },
  ];

  return (
    <div
      className={cn(
        "border border-border rounded-lg overflow-hidden",
        className
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <div className="w-10" />
        <div className="w-12" />
        <div className="flex-1">Name</div>
        <div className="w-24 text-center">Type</div>
        <div className="w-20 text-right">Size</div>
        <div className="w-28 text-right hidden md:block">Dimensions</div>
        <div className="w-28 text-right hidden lg:block">Uploaded</div>
      </div>

      {/* Data rows */}
      <div className="divide-y divide-border">
        {media.map(item => {
          const isSelected = selectedIds.has(item.id);
          const type = getMediaType(item.mimeType);
          const isImage = type === "image";

          return (
            <div
              key={item.id}
              className={cn(
                "flex items-center gap-3 px-3 py-2 transition-colors cursor-pointer",
                "hover:bg-accent/50",
                isSelected && "bg-primary/5"
              )}
              onClick={() => onEdit?.(item)}
              role="row"
              aria-selected={isSelected}
            >
              {/* Checkbox */}
              <div
                className="w-10 flex justify-center"
                onClick={e => e.stopPropagation()}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onSelectionChange?.(item.id)}
                  aria-label={`Select ${item.originalFilename}`}
                />
              </div>

              {/* Thumbnail */}
              <div className="w-12 h-10 rounded overflow-hidden bg-muted flex items-center justify-center flex-shrink-0">
                {isImage && item.thumbnailUrl ? (
                  <img
                    src={item.thumbnailUrl}
                    alt={item.altText || item.originalFilename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : isImage && item.url ? (
                  <img
                    src={item.url}
                    alt={item.altText || item.originalFilename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <MediaTypeIcon mimeType={item.mimeType} />
                )}
              </div>

              {/* Name */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {item.originalFilename}
                </p>
                {item.altText && (
                  <p className="text-xs text-muted-foreground truncate">
                    {item.altText}
                  </p>
                )}
              </div>

              {/* Type badge */}
              <div className="w-24 text-center">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full",
                    type === "image" && "bg-blue-500/10 text-blue-600",
                    type === "video" && "bg-purple-500/10 text-purple-600",
                    type === "audio" && "bg-green-500/10 text-green-600",
                    type === "document" && "bg-orange-500/10 text-orange-600",
                    type === "other" && "bg-muted text-muted-foreground"
                  )}
                >
                  <MediaTypeIcon mimeType={item.mimeType} />
                  <span className="capitalize">{type}</span>
                </span>
              </div>

              {/* Size */}
              <div className="w-20 text-right text-sm text-muted-foreground">
                {formatFileSize(item.size)}
              </div>

              {/* Dimensions (hidden on mobile) */}
              <div className="w-28 text-right text-sm text-muted-foreground hidden md:block">
                {formatDimensions(item.width, item.height)}
              </div>

              {/* Date (hidden on smaller screens) */}
              <div className="w-28 text-right text-sm text-muted-foreground hidden lg:block">
                {formatDate(item.uploadedAt)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
