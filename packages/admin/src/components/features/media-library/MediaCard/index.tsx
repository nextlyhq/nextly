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
 * - **Visual States**: Default, hover (scale + shadow), selected  (border border-primary/5 + ring), focus (keyboard ring)
 * - **Responsive**: Touch-friendly on mobile (44×44px touch targets), compact on desktop
 *
 * ## Design Specifications
 *
 * - **Aspect Ratio**: Square (1:1) using `aspect-square`
 * - **Border**: Default  `border border-primary/5`, Selected  `border border-primary/5 border-primary`
 * - **Border Radius**: 8px (`rounded-none`)
 * - **Hover State**: `border-primary-300 scale-105 shadow-md` (NOT when selected)
 * - **Selected State**: `border-2 border-primary-500 ring-2 ring-primary-500`, no scale
 * - **Focus State**: `ring-2 ring-primary-500 ring-offset-2` (keyboard navigation)
 * - **Transition**: `transition-all duration-150` (design system standard)
 * - **Bottom Overlay**: `bg-gradient-to-t from-black/60 to-transparent`, white text
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

import { Checkbox } from "@revnixhq/ui";
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
 * 3. **Selected**: Blue  border border-primary/5 (2px), blue ring, no scale on hover
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
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      aria-label={`${media.filename} - ${media.mimeType}`}
      aria-selected={isSelected}
      className={cn(
        "group relative aspect-square rounded-none overflow-hidden bg-card/50 transition-all duration-300  border border-primary/5 flex flex-col",
        isSelected
          ? "ring-2 ring-primary/30 ring-offset-2 border-primary/30 cursor-pointer"
          : "hover:border-primary/40 cursor-pointer",
        className
      )}
    >
      {/* Image Preview Container - Flex-1 to push info bar down */}
      <div className="relative flex-1 flex items-center justify-center p-4 min-h-0">
        {!imageError && media.url ? (
          <img
            src={media.url}
            alt={media.altText || media.originalFilename || media.filename}
            loading="lazy"
            onLoad={() => setImageLoading(false)}
            onError={() => {
              setImageError(true);
              setImageLoading(false);
            }}
            className={cn(
              "max-w-full max-h-full object-contain drop-shadow-sm",
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
            <MediaTypeIcon className="w-12 h-12 text-muted-foreground/40" />
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
            className="h-5 w-5 bg-background/80 backdrop-blur-sm data-[state=checked]:bg-primary border-primary/5 transition-all"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Information Bar - Integrated at bottom of aspect-square */}
      <div className="bg-primary/5  border-t border-primary/5 p-3 shrink-0">
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate leading-none tracking-tight">
            {media.originalFilename || media.filename}
          </p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              {media.width && media.height
                ? `${media.width}×${media.height}`
                : "No Size"}
            </span>
            <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tighter">
              {formatFileSize(media.size)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
