"use client";

/**
 * MediaCard Component
 *
 * One tile in the media grid, shared by the library and the media picker: a
 * square of neutral backdrop with the image fitted inside it (from the
 * lightest stored copy, chosen by `mediaImageSrc`), the name
 * and the file's facts underneath, a "No alt text" mark on an image that has
 * none, and a checkbox for bulk actions when the grid offers selection.
 *
 * - Enter or Space opens the tile, as a button would; the checkbox keeps its
 *   own Space.
 * - `aria-current` marks the tile whose details are open beside the grid, and
 *   a ring draws it.
 *
 * @see types/ui/media-card.ts - MediaCardProps interface
 */

import { Badge, Checkbox } from "@nextlyhq/ui";
import type React from "react";
import { useState } from "react";

import {
  File,
  FileText,
  Image as ImageIcon,
  Music,
  Video,
} from "@admin/components/icons";
import {
  formatFileSize,
  getMediaType,
  mediaImageSrc,
} from "@admin/lib/media-utils";
import { cn } from "@admin/lib/utils";
import type { MediaCardProps } from "@admin/types/ui/media-card";

/**
 * Get icon component for media type
 *
 * Returns the appropriate lucide-react icon based on media MIME type.
 *
 * @param mimeType - MIME type string (e.g., "image/png")
 * @returns Icon component for the media type
 */
function getMediaTypeIcon(mimeType: string) {
  const type = getMediaType(mimeType);
  switch (type) {
    case "image":
      return ImageIcon;
    case "video":
      return Video;
    case "document":
      return FileText;
    case "audio":
      return Music;
    default:
      return File;
  }
}

/**
 * MediaCard component: one tile of the grid. Renders only; the grid decides
 * what a click does.
 */
export function MediaCard({
  media,
  isSelected = false,
  isCurrent = false,
  onSelectionChange,
  onClick,
  className = "",
}: MediaCardProps): React.JSX.Element {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  const MediaTypeIcon = getMediaTypeIcon(media.mimeType);
  const isImage = getMediaType(media.mimeType) === "image";
  // An image with nothing for a screen reader to say is the work this mark
  // points at; a document or a video has no alt text to miss.
  const missingAltText = isImage && !media.altText;
  const name = media.originalFilename || media.filename;

  // Handle card click (not checkbox or actions)
  const handleCardClick = () => {
    onClick?.(media);
  };

  // Enter and Space both open the tile, as they would a button: its role says
  // it is one. The checkbox is its own control and keeps its own Space.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardClick();
    }
  };

  // Determine if checkbox should be shown
  const showCheckbox = onSelectionChange !== undefined;

  // Named once so the rendered text and its `title` fallback cannot drift.
  const dimensionsLabel =
    media.width && media.height ? `${media.width}×${media.height}` : null;
  const sizeLabel = formatFileSize(media.size);
  const metaLabel = dimensionsLabel
    ? `${dimensionsLabel} · ${sizeLabel}`
    : sizeLabel;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      // The attribute the list view's rows carry too, so the library finds
      // an item's entry the same way in either view.
      data-row-id={media.id}
      // The name the tile shows, which is the one a person searches or
      // speaks; `filename` is the storage's path for the file.
      aria-label={`${name} - ${media.mimeType}`}
      aria-selected={isSelected}
      // The tile whose details are open beside the grid.
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "group flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg text-left outline-none",
        className
      )}
    >
      {/* The thumbnail: a square of neutral backdrop with the image fitted
          inside it, so a whole-image size keeps a wide or tall picture's
          edges; the stored square thumbnail, used when there is none, is
          already a centre crop. The
          focus ring and the open tile's ring sit on this square, which is
          what a person reads as the tile. */}
      <div
        className={cn(
          "relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-muted transition-colors",
          isSelected
            ? "border-primary"
            : "border-border group-hover:border-primary",
          isCurrent &&
            "ring-2 ring-primary ring-offset-2 ring-offset-background",
          "group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background"
        )}
      >
        {!imageError && media.url && isImage ? (
          <img
            src={mediaImageSrc(media, { purpose: "tile" })}
            alt={media.altText || name}
            loading="lazy"
            decoding="async"
            onLoad={() => setImageLoading(false)}
            onError={() => {
              setImageError(true);
              setImageLoading(false);
            }}
            className={cn(
              "h-full w-full object-contain transition-opacity duration-300",
              imageLoading ? "opacity-0" : "opacity-100"
            )}
          />
        ) : null}

        {/* Loading/Error states */}
        {isImage && imageLoading && !imageError && (
          <div className="absolute inset-0 animate-pulse bg-accent" />
        )}
        {(!isImage || imageError) && (
          <MediaTypeIcon className="h-10 w-10 text-muted-foreground" />
        )}

        {missingAltText && (
          <Badge
            variant="warning"
            className="absolute bottom-2 left-2 text-xs font-semibold"
          >
            No alt text
          </Badge>
        )}

        {/* Checkbox Overlay (top-left) - Higher Z for interaction */}
        {showCheckbox && (
          <div className="absolute top-2 left-2 z-30">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onSelectionChange?.(media.id)}
              aria-label={`Select ${name}`}
              className="h-5 w-5 bg-background data-[state=checked]:bg-primary border-border transition-all"
              onClick={e => e.stopPropagation()}
            />
          </div>
        )}
      </div>

      {/* Name and facts under the square rather than over the picture, so
          neither hides part of the image. */}
      <div className="min-w-0 px-0.5">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <p
          title={metaLabel}
          className="truncate text-xs text-muted-foreground tabular-nums"
        >
          {metaLabel}
        </p>
      </div>
    </div>
  );
}
