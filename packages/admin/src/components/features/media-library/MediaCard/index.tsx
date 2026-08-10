"use client";

/**
 * MediaCard Component
 *
 * Individual media item card with image preview, metadata, checkbox selection, and actions menu.
 * Used in MediaGrid to display media files in the Media Library.
 *
 * ## Features
 *
 * - **Image Preview**: Aspect-square with object-contain, centered, loading and error states
 * - **Checkbox Selection**: Top-left overlay for bulk operations (44×44px mobile, 20×20px desktop)
 * - **Actions Menu**: Top-right dropdown with Edit/Delete/Copy URL/Download (44×44px mobile, 32×32px desktop)
 * - **Bottom Overlay**: Gradient background with filename and file type badge
 * - **Visual States**: Default, hover (border emphasis + image scale), selected (primary border)
 * - **Responsive**: Touch-friendly on mobile (44×44px touch targets), compact on desktop
 *
 * ## Design Specifications
 *
 * - **Aspect Ratio**: Square (1:1) using `aspect-square`
 * - **Border**: Default `border border-border`, Selected `border-primary`
 * - **Border Radius**: `rounded-lg`, the container step of the `--radius` scale
 * - **Hover State**: `hover:border-primary` on the card, image scales (`group-hover:scale-105`); no shadow
 * - **Selected State**: `border-primary`, no ring, no scale
 * - **Transition**: `transition-all duration-300`
 * - **Bottom Bar**: token surface (`bg-primary/5`, `border-t border-border`)
 * - **Filename**: `text-sm font-medium truncate`
 * - **Badge**: Type-based (image=success, video=primary, document=default, audio=warning)
 *
 * ## Accessibility
 *
 * - **WCAG 2.2 AA Compliant**: 4.5:1 text contrast, 3:1 UI contrast
 * - **Touch Targets**: 44×44px minimum on mobile (WCAG 2.5.5)
 * - **Keyboard Navigation**: Tab to focus, Enter to click, Space to toggle checkbox
 * - **ARIA**: aria-label, aria-selected, proper role attributes
 * - **Focus Indicators**: 2px ring with offset for keyboard users
 * - **Screen Reader**: All interactive elements properly labeled
 *
 * @see types/ui/media-card.ts - MediaCardProps interface
 *
 * @example
 * ```tsx
 * // Basic usage
 * <MediaCard
 *   media={mediaItem}
 *   isSelected={false}
 *   onClick={(media) => console.log('Clicked:', media)}
 * />
 *
 * // With selection and actions
 * <MediaCard
 *   media={mediaItem}
 *   isSelected={selectedIds.has(mediaItem.id)}
 *   onSelectionChange={handleSelectionToggle}
 *   onClick={handleMediaClick}
 *   onEdit={handleEdit}
 *   onDelete={handleDelete}
 *   onCopyUrl={handleCopyUrl}
 *   onDownload={handleDownload}
 * />
 * ```
 */

import { Checkbox } from "@nextlyhq/ui";
import type React from "react";
import { useState } from "react";

import {
  File,
  FileText,
  Image as ImageIcon,
  Music,
  Video,
} from "@admin/components/icons";
import { formatFileSize, getMediaType } from "@admin/lib/media-utils";
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
 * MediaCard component
 *
 * Individual media item card for the Media Library grid.
 *
 * ## Component States
 *
 * 1. **Default**: Border, no hover effects
 * 2. **Hover**: Border color change, scale-105, shadow-md (only if NOT selected)
 * 3. **Selected**: Blue  border border-border (2px), blue ring, no scale on hover
 * 4. **Focus**: Keyboard focus ring (2px offset)
 * 5. **Image Loading**: Shows skeleton/placeholder
 * 6. **Image Error**: Shows fallback icon
 *
 * ## Layout Sections
 *
 * 1. **Checkbox Overlay** (top-left): Conditional rendering, 20×20px desktop / 44×44px mobile
 * 2. **Actions Menu** (top-right): MoreVertical icon, 32×32px desktop / 44×44px mobile
 * 3. **Image Preview** (center): aspect-square, object-contain, loading="lazy"
 * 4. **Bottom Overlay** (bottom): Gradient background, filename + badge
 *
 * @param props - MediaCardProps
 * @returns Individual media card element
 * @example
 */
export function MediaCard({
  media,
  isSelected = false,
  onSelectionChange,
  onClick,
  className = "",
}: MediaCardProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  const MediaTypeIcon = getMediaTypeIcon(media.mimeType);

  // Handle card click (not checkbox or actions)
  const handleCardClick = () => {
    onClick?.(media);
  };

  // Handle keyboard navigation
  // Only Enter triggers card click - Space is reserved for checkbox toggle
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCardClick();
    }
  };

  // Determine if checkbox should be shown
  const showCheckbox = onSelectionChange !== undefined;

  // Named once so the rendered text and its `title` fallback cannot drift.
  const dimensionsLabel =
    media.width && media.height ? `${media.width}×${media.height}` : "No Size";
  const sizeLabel = formatFileSize(media.size);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      aria-label={`${media.filename} - ${media.mimeType}`}
      aria-selected={isSelected}
      className={cn(
        "group relative aspect-square rounded-lg overflow-hidden bg-card/50 transition-all duration-300  border border-border flex flex-col",
        // Selected uses border-primary; unselected gets it on hover, keeping the states distinct and the active boundary perceivable.
        isSelected
          ? "border-primary cursor-pointer"
          : "hover:border-primary cursor-pointer",
        className
      )}
    >
      {/* Image Preview Container - Flex-1 to push info bar down.
          Prefers the auto-promoted thumbnail (smallest configured variant
          named "thumbnail" if any) so grid tiles load fast on large
          assets. Falls back to the original URL. */}
      <div className="relative flex-1 flex items-center justify-center p-4 min-h-0">
        {!imageError && media.url ? (
          <img
            src={media.thumbnailUrl ?? media.url}
            alt={media.altText || media.originalFilename || media.filename}
            loading="lazy"
            onLoad={() => setImageLoading(false)}
            onError={() => {
              setImageError(true);
              setImageLoading(false);
            }}
            className={cn(
              "max-w-full max-h-full object-contain",
              imageLoading ? "opacity-0" : "opacity-100",
              "transition-all duration-500 group-hover:scale-105"
            )}
          />
        ) : null}

        {/* Loading/Error states */}
        {imageLoading && !imageError && (
          <div className="absolute inset-0 bg-accent/50 animate-pulse" />
        )}
        {imageError && (
          <div className="absolute inset-0 bg-accent/50 flex items-center justify-center">
            <MediaTypeIcon className="w-12 h-12 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Checkbox Overlay (top-left) - Higher Z for interaction */}
      {showCheckbox && (
        <div className="absolute top-3 left-3 z-30">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onSelectionChange?.(media.id)}
            aria-label={`Select ${media.filename}`}
            className="h-5 w-5 bg-background/80 backdrop-blur-sm data-[state=checked]:bg-primary border-border transition-all"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Information Bar - Integrated at bottom of aspect-square */}
      <div className="bg-primary/5  border-t border-border p-3 shrink-0">
        {/* A container context on the metadata column, so the row below keys off
         * the width it actually gets rather than the viewport: the grid's column
         * count and the sidebar move card width independently of any breakpoint,
         * and at `lg` the six columns leave the row about 58px wide. */}
        <div className="@container/meta flex flex-col gap-1.5">
          <p className="text-xs font-bold text-foreground dark:text-muted-foreground truncate leading-none tracking-tight">
            {media.originalFilename || media.filename}
          </p>
          {/* The pair needs roughly 160px to render whole, which the row only
           * has on wide cards. Below that the size wins the space: it is the one
           * value every asset has (audio and documents have no dimensions) and
           * the one the preview cannot convey, whereas an image's proportions
           * are already visible in the thumbnail above. Dimensions are therefore
           * shown only once the row can hold both in full, so the value is never
           * a partial number, and the row's `title` keeps them readable at every
           * width — unlike a tooltip on the span itself, which is unreachable
           * once the span is squeezed to zero. `truncate` on both is the floor
           * that keeps a long label, `Invalid size` included, inside the card. */}
          <div
            title={`${dimensionsLabel} · ${sizeLabel}`}
            className="flex items-center justify-between gap-2"
          >
            <span className="hidden @min-[10rem]/meta:inline text-xs font-medium text-muted-foreground dark:text-muted-foreground uppercase tracking-widest min-w-0 truncate">
              {dimensionsLabel}
            </span>
            <span className="text-xs font-bold text-muted-foreground dark:text-muted-foreground uppercase tracking-tighter min-w-0 truncate">
              {sizeLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
