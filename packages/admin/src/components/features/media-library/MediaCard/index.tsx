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
 * - **Visual States**: Default, hover (scale + shadow), selected (border + ring), focus (keyboard ring)
 * - **Responsive**: Touch-friendly on mobile (44×44px touch targets), compact on desktop
 *
 * ## Design Specifications
 *
 * - **Aspect Ratio**: Square (1:1) using `aspect-square`
 * - **Border**: Default `border border-border`, Selected `border border-primary`
 * - **Border Radius**: 8px (`rounded-lg`)
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
  Copy,
  Download,
  Edit,
  File,
  FileText,
  Image as ImageIcon,
  Music,
  Trash2,
  Video,
} from "@admin/components/icons";
import { getMediaType } from "@admin/lib/media-utils";
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
 * 3. **Selected**: Blue border (2px), blue ring, no scale on hover
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
  onEdit,
  onDelete,
  onCopyUrl,
  onDownload,
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

  const handleDownloadClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!media.url) return;
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

      // Successfully downloaded, no need to call parent onDownload which might duplicate action
    } catch {
      window.open(media.url, "_blank");
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(media);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      aria-label={`${media.filename} - ${media.mimeType}`}
      aria-selected={isSelected}
      className={cn(
        "group relative aspect-square rounded-xl overflow-hidden cursor-pointer flex items-center justify-center",
        "bg-white dark:bg-slate-900/50",
        "transition-all duration-200",
        "border",
        isSelected
          ? "border-primary ring-1 ring-primary/40 ring-offset-2"
          : "border-border/50 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10",
        "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
        className
      )}
    >
      {!imageError && media.url ? (
        <img
          src={media.url}
          alt={media.altText || media.filename}
          loading="lazy"
          onLoad={() => setImageLoading(false)}
          onError={() => {
            setImageError(true);
            setImageLoading(false);
          }}
          className={cn(
            "max-w-full max-h-full object-contain",
            imageLoading ? "opacity-0" : "opacity-100",
            "transition-opacity duration-150"
          )}
        />
      ) : null}

      {/* Loading State */}
      {imageLoading && !imageError && (
        <div className="absolute inset-0 bg-accent animate-pulse" />
      )}

      {/* Error State - Fallback Icon */}
      {imageError && (
        <div className="absolute inset-0 bg-accent flex items-center justify-center">
          <MediaTypeIcon className="w-12 h-12 text-muted-foreground" />
        </div>
      )}

      {/* Checkbox Overlay (top-left) */}
      {showCheckbox && (
        <div className="absolute top-2 left-2 z-10">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onSelectionChange?.(media.id)}
            aria-label={`Select ${media.filename}`}
            className="h-5 w-5 bg-white/10 backdrop-blur-sm data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground border-white/60 hover:border-white shadow-lg"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Actions Overlay (Bottom Slide-up) */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-6 py-4 bg-background/95 backdrop-blur-md border-t border-border translate-y-full group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300 ease-out shadow-sm">
        {onEdit && (
          <button
            onClick={handleEditClick}
            className="text-muted-foreground hover:text-foreground hover:scale-110 transition-all cursor-pointer"
            aria-label="Edit"
            title="Edit"
          >
            <Edit className="h-4 w-4" />
          </button>
        )}
        {onCopyUrl && (
          <button
            onClick={e => {
              e.stopPropagation();
              onCopyUrl(media.url);
            }}
            className="text-muted-foreground hover:text-foreground hover:scale-110 transition-all cursor-pointer"
            aria-label="Copy URL"
            title="Copy URL"
          >
            <Copy className="h-4 w-4" />
          </button>
        )}
        {onDownload && (
          <button
            onClick={e => {
              void handleDownloadClick(e);
            }}
            className="text-muted-foreground hover:text-foreground hover:scale-110 transition-all cursor-pointer"
            aria-label="Download"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={e => {
              e.stopPropagation();
              onDelete(media);
            }}
            className="text-muted-foreground hover:text-destructive hover:scale-110 transition-all cursor-pointer"
            aria-label="Delete"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Bottom Overlay removed as requested */}
    </div>
  );
}
