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
  Badge,
  Button,
} from "@nextlyhq/ui";
import { useMemo } from "react";

import {
  AlertTriangle,
  Folder,
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  File,
} from "@admin/components/icons";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type {
  DataTableSelection,
  NextlyColumn,
} from "@admin/components/ui/table/data-table";
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
  onToggleAll?: (selected: boolean) => void;
  onItemClick?: (media: Media) => void;
  onEdit?: (media: Media) => void;
  onDelete?: (media: Media) => void;
  onCopyUrl?: (url: string) => void;
  onDownload?: (media: Media) => void;
  onRetry?: () => void;
  hiddenColumns?: Set<string>;
  className?: string;
  emptyStateMessage?: string;
}

// Get the right icon for a media type
function MediaTypeIcon({
  mimeType,
  className,
}: {
  mimeType: string;
  className?: string;
}) {
  const type = getMediaType(mimeType);
  switch (type) {
    case "image":
      return <FileImage className={cn("h-4 w-4", className)} />;
    case "video":
      return <FileVideo className={cn("h-4 w-4", className)} />;
    case "audio":
      return <FileAudio className={cn("h-4 w-4", className)} />;
    case "document":
      return <FileText className={cn("h-4 w-4", className)} />;
    default:
      return <File className={cn("h-4 w-4", className)} />;
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
  hiddenColumns = new Set(),
  onSelectionChange,
  onToggleAll,
  onEdit,
  onRetry,
  className = "",
  emptyStateMessage,
}: MediaListViewProps) {
  const columns = useMemo<NextlyColumn<Media>[]>(() => {
    const allColumns: NextlyColumn<Media>[] = [
      {
        name: "originalFilename",
        header: "NAME",
        cell: ({ row: item }) => {
          const type = getMediaType(item.mimeType);
          const isImage = type === "image";
          return (
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-none border border-border bg-card/50">
                {isImage && (item.thumbnailUrl || item.url) ? (
                  <img
                    src={item.thumbnailUrl ?? item.url}
                    alt={item.altText || item.originalFilename}
                    className="block max-h-full max-w-full"
                    style={{ objectFit: "contain" }}
                    loading="lazy"
                  />
                ) : (
                  <MediaTypeIcon mimeType={item.mimeType} />
                )}
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {item.originalFilename}
                </span>
                {item.altText && (
                  <span className="truncate text-xs text-muted-foreground">
                    {item.altText}
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        name: "mimeType",
        header: "TYPE",
        align: "center",
        cell: ({ row: item }) => (
          <Badge
            variant="default"
            className="rounded-none border border-border bg-muted px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-tight text-foreground"
          >
            {getMediaType(item.mimeType)}
          </Badge>
        ),
      },
      {
        name: "size",
        header: "SIZE",
        align: "right",
        cell: ({ value }) => (
          <span className="text-sm text-muted-foreground">
            {formatFileSize(Number(value))}
          </span>
        ),
      },
      {
        name: "width",
        header: "DIMENSIONS",
        hideOnMobile: true,
        align: "right",
        cell: ({ row: item }) => (
          <span className="text-sm text-muted-foreground">
            {formatDimensions(item.width, item.height)}
          </span>
        ),
      },
      {
        name: "uploadedAt",
        header: "UPLOADED",
        hideOnMobile: true,
        align: "right",
        cell: ({ value }) => (
          <span className="text-sm text-muted-foreground">
            {formatDate(value as string | Date)}
          </span>
        ),
      },
    ];

    return allColumns.map(col => ({
      ...col,
      hidden: hiddenColumns.has(col.name),
    }));
  }, [hiddenColumns]);

  const selection = useMemo<DataTableSelection<Media> | undefined>(() => {
    if (!onSelectionChange) return undefined;
    return {
      selectedIds: Array.from(selectedIds),
      onToggle: item => onSelectionChange(item.id),
      onToggleAll: (_rows, allSelected) => onToggleAll?.(!allSelected),
    };
  }, [selectedIds, onSelectionChange, onToggleAll]);

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
            className="flex items-center gap-4 p-3 rounded-none  border border-border animate-pulse"
          >
            <div className="w-10 h-10 rounded-none bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-48 bg-muted rounded-none" />
              <div className="h-3 w-24 bg-muted rounded-none" />
            </div>
            <div className="h-3 w-16 bg-muted rounded-none" />
            <div className="h-3 w-20 bg-muted rounded-none" />
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
              <Button variant="outline" size="md" onClick={onRetry}>
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
        className="flex flex-col items-center justify-center py-16 px-4 text-center"
        role="status"
        aria-label="No media files"
      >
        <Folder className="w-16 h-16 text-muted-foreground/20 mb-6" />
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

  return (
    <DataTableView<Media>
      columns={columns}
      rows={media}
      selection={selection}
      onRowClick={onEdit}
      primaryColumn="originalFilename"
      bordered={false}
      registryKey="media"
      ariaLabel="Media files table"
      emptyMessage={emptyStateMessage}
      className={className}
    />
  );
}
