/**
 * MediaCard Component Types
 *
 * Type definitions for the MediaCard component used in the Media Library.
 *
 * @see components/features/media-library/MediaCard
 */

import type { Media } from "../media";

/**
 * MediaCard component props
 *
 * One tile of the media grid: the whole image fitted inside a square of
 * neutral backdrop, with the name and the file's facts underneath.
 *
 * ```
 * ┌─────────────────┐
 * │ [□]             │  ← Checkbox, when the grid offers selection
 * │     image,      │  ← Fitted whole (object-contain), never cropped
 * │     whole       │
 * │ [No alt text]   │  ← On an image with no alt text
 * └─────────────────┘
 *   filename.jpg
 *   1920×800 · 2 KB
 * ```
 *
 * Enter or Space opens the tile; `isCurrent` marks the one whose details are
 * open.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <MediaCard
 *   media={mediaItem}
 *   isSelected={false}
 *   onSelectionChange={(id) => console.log('Selected:', id)}
 *   onClick={(media) => console.log('Clicked:', media)}
 * />
 *
 * // With all action handlers
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
 *
 * // In selection mode (shows checkbox)
 * <MediaCard
 *   media={mediaItem}
 *   isSelected={true}
 *   onSelectionChange={handleSelectionToggle}
 * />
 * ```
 */
export type MediaCardProps = {
  /**
   * Media item to display
   */
  media: Media;

  /**
   * Whether this card is selected (for bulk operations)
   * @default false
   */
  isSelected?: boolean;

  /**
   * Whether this card's details are the ones open beside the grid. Separate
   * from `isSelected`, which is the bulk selection: a person can read one
   * item's details while several others are ticked.
   * @default false
   */
  isCurrent?: boolean;

  /**
   * Callback when selection state changes (checkbox toggle)
   * If provided, checkbox will be visible
   */
  onSelectionChange?: (id: string) => void;

  /**
   * Callback when card is clicked (not checkbox or actions menu)
   */
  onClick?: (media: Media) => void;

  /**
   * Callback when "Edit" action is clicked in actions menu
   */
  onEdit?: (media: Media) => void;

  /**
   * Callback when "Delete" action is clicked in actions menu
   */
  onDelete?: (media: Media) => void;

  /**
   * Callback when "Copy URL" action is clicked in actions menu
   */
  onCopyUrl?: (url: string) => void;

  /**
   * Callback when "Download" action is clicked in actions menu
   */
  onDownload?: (media: Media) => void;

  /**
   * Optional CSS class name for additional styling
   */
  className?: string;
};
