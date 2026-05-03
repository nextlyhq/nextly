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
  ResponsiveTable,
  type Column,
} from "@revnixhq/ui";
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
import { BulkSelectCheckbox } from "@admin/components/shared/bulk-select-checkbox";
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
  const selectAllState: boolean | "indeterminate" = useMemo(() => {
    if (media.length === 0) return false;
    const selectedCount = media.filter(m => selectedIds.has(m.id)).length;
    if (selectedCount === 0) return false;
    if (selectedCount === media.length) return true;
    return "indeterminate";
  }, [media, selectedIds]);

  const columnDefs: Column<Media>[] = useMemo(() => {
    const allColumns: Column<Media>[] = [
      {
        key: "id",
        label: (
          <BulkSelectCheckbox
            checked={selectAllState}
            onCheckedChange={checked => onToggleAll?.(checked === true)}
            rowId="select-all"
            rowLabel="Select all media on page"
          />
        ),
        headerClassName: "w-12 px-0 text-center",
        cellClassName: "w-12 px-0 text-center",
        render: (_, item) => (
          <div className="flex justify-center">
            <BulkSelectCheckbox
              checked={selectedIds.has(item.id)}
              onCheckedChange={() => onSelectionChange?.(item.id)}
              rowId={item.id}
              rowLabel={item.originalFilename}
            />
          </div>
        ),
      },
      {
        key: "originalFilename",
        label: "NAME",
        headerClassName: "text-left pl-0",
        cellClassName: "text-left pl-0",
        render: (_, item) => {
          const type = getMediaType(item.mimeType);
          const isImage = type === "image";
          return (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 overflow-hidden bg-card/50 flex items-center justify-center flex-shrink-0  border border-primary/5 rounded-none">
                {isImage && item.thumbnailUrl ? (
                  <img
                    src={item.thumbnailUrl}
                    alt={item.altText || item.originalFilename}
                    className="max-w-full max-h-full block"
                    style={{ objectFit: "contain" }}
                    loading="lazy"
                  />
                ) : isImage && item.url ? (
                  <img
                    src={item.url}
                    alt={item.altText || item.originalFilename}
                    className="max-w-full max-h-full block"
                    style={{ objectFit: "contain" }}
                    loading="lazy"
                  />
                ) : (
                  <MediaTypeIcon mimeType={item.mimeType} />
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">
                  {item.originalFilename}
                </span>
                {item.altText && (
                  <span className="text-xs text-muted-foreground truncate">
                    {item.altText}
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        key: "mimeType",
        label: "TYPE",
        headerClassName: "text-center",
        cellClassName: "text-center",
        render: (_, item) => {
          const type = getMediaType(item.mimeType);
          return (
            <Badge
              variant="default"
              className="text-[10px] font-semibold px-2.5 py-0.5 rounded-none bg-primary/5 text-primary  border border-primary/5 uppercase tracking-tight"
            >
              {type}
            </Badge>
          );
        },
      },
      {
        key: "size",
        label: "SIZE",
        headerClassName: "text-right",
        cellClassName: "text-right font-medium",
        render: size => (
          <span className="text-sm text-muted-foreground">
            {formatFileSize(Number(size))}
          </span>
        ),
      },
      {
        key: "width",
        label: "DIMENSIONS",
        hideOnMobile: true,
        headerClassName: "text-right",
        cellClassName: "text-right",
        render: (_, item) => (
          <span className="text-sm text-muted-foreground">
            {formatDimensions(item.width, item.height)}
          </span>
        ),
      },
      {
        key: "uploadedAt",
        label: "UPLOADED",
        hideOnMobile: true,
        headerClassName: "text-right",
        cellClassName: "text-right",
        render: date => (
          <span className="text-sm text-muted-foreground">
            {formatDate(date as string | Date)}
          </span>
        ),
      },
    ];

    return allColumns.filter(col => !hiddenColumns.has(col.key as string));
  }, [
    selectAllState,
    onToggleAll,
    selectedIds,
    onSelectionChange,
    hiddenColumns,
  ]);

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
            className="flex items-center gap-4 p-3 rounded-none  border border-primary/5 animate-pulse"
          >
            <div className="w-10 h-10 rounded-none bg-primary/5" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-48 bg-primary/5 rounded-none" />
              <div className="h-3 w-24 bg-primary/5 rounded-none" />
            </div>
            <div className="h-3 w-16 bg-primary/5 rounded-none" />
            <div className="h-3 w-20 bg-primary/5 rounded-none" />
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
    <ResponsiveTable
      data={media}
      columns={columnDefs}
      onRowClick={onEdit}
      emptyMessage={emptyStateMessage as string}
      tableWrapperClassName="border-0 rounded-none shadow-none"
      className={className}
    />
  );
}
