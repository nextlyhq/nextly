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
 * Individual media item card with preview, metadata, checkbox selection, and actions menu.
 *
 * ## Design Specifications
 *
 * - **Aspect Ratio**: Square (1:1) using `aspect-square`
 * - **Border**: Default `border border-border`, Selected `border-2 border-primary-500`
 * - **Border Radius**: 8px (`rounded-lg`)
 * - **Hover State**: `border-primary-300`, `scale-105`, `shadow-md` (NOT applied when selected)
 * - **Selected State**: `border-2 border-primary-500`, `ring-2 ring-primary-500`, no scale
 * - **Focus State**: `ring-2 ring-primary-500 ring-offset-2` (keyboard navigation)
 * - **Transition**: `transition-all duration-150` (design system standard)
 *
 * ## Layout Structure
 *
 * ```
 * ┌─────────────────┐
 * │ [□]         [⋮] │  ← Checkbox (top-left) + Actions menu (top-right)
 * │                 │
 * │   Image         │  ← Image preview (aspect-square, object-cover)
 * │   Preview       │
 * │                 │
 * │─────────────────│
 * │ filename.jpg    │  ← Bottom overlay: Filename
 * │  [IMG]          │  ← Badge (file type)
 * └─────────────────┘
 * ```
 *
 * ## Accessibility
 *
 * - **Touch Targets**: Desktop 20×20px checkbox/32×32px actions, Mobile 44×44px (WCAG 2.5.5)
 * - **Keyboard Navigation**: Tab to focus, Enter to click, Space to toggle checkbox
 * - **ARIA**: aria-label with filename, aria-selected for selection state
 * - **Focus Indicators**: 2px ring with primary-500 color
 * - **Screen Reader**: All interactive elements properly labeled
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
