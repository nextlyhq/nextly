/**
 * MediaGrid Component Types
 *
 * Type definitions for the MediaGrid component.
 *
 * @see components/features/media-library/MediaGrid - Implementation
 */

import type { Media } from "../media";

/**
 * MediaGrid component props
 *
 * Props for the MediaGrid component that displays media files in a responsive grid layout.
 *
 * @example
 * ```tsx
 * import { MediaGrid } from '@nextly/admin';
 * import { useMedia } from '@nextly/admin';
 * import { useRowSelection } from '@nextly/admin';
 *
 * function MediaLibrary() {
 *   const { data, isLoading, error, refetch } = useMedia({ page: 1, pageSize: 24 });
 *   const { selectedIds, toggleSelection } = useRowSelection();
 *
 *   return (
 *     <MediaGrid
 *       media={data?.data || []}
 *       isLoading={isLoading}
 *       error={error}
 *       selectedIds={selectedIds}
 *       onSelectionChange={toggleSelection}
 *       onItemClick={(media) => console.log('Clicked:', media.filename)}
 *       onRetry={refetch}
 *     />
 *   );
 * }
 * ```
 */
export interface MediaGridProps {
  /**
   * Array of media items to display in the grid.
   * Empty array triggers empty state.
   */
  media: Media[];

  /**
   * Loading state indicator.
   * When true, displays skeleton cards (12 items).
   *
   * @default false
   */
  isLoading?: boolean;

  /**
   * Error object when media fetch fails.
   * When not null, displays error alert with retry button.
   *
   * @default null
   */
  error?: Error | null;

  /**
   * Set of selected media item IDs for bulk operations.
   * Used with useRowSelection hook.
   *
   * @default new Set()
   */
  selectedIds?: Set<string>;

  /**
   * Callback fired when a media item's selection state changes.
   * Typically toggles the item in selectedIds Set.
   *
   * @param id - Media item ID to toggle selection
   *
   * @example
   * ```tsx
   * const { toggleSelection } = useRowSelection();
   * <MediaGrid onSelectionChange={toggleSelection} />
   * ```
   */
  onSelectionChange?: (id: string) => void;

  /**
   * Callback fired when a media item is clicked.
   * Used to open media detail view or editor.
   *
   * @param media - Media item that was clicked
   *
   * @example
   * ```tsx
   * <MediaGrid
   *   onItemClick={(media) => {
   *     setSelectedMedia(media);
   *     setEditDialogOpen(true);
   *   }}
   * />
   * ```
   */
  onItemClick?: (media: Media) => void;

  /**
   * Callback fired when "Edit" action is clicked in MediaCard actions menu.
   *
   * @param media - Media item to edit
   */
  onEdit?: (media: Media) => void;

  /**
   * Callback fired when "Delete" action is clicked in MediaCard actions menu.
   *
   * @param media - Media item to delete
   */
  onDelete?: (media: Media) => void;

  /**
   * Callback fired when "Copy URL" action is clicked in MediaCard actions menu.
   *
   * @param url - Media URL to copy to clipboard
   */
  onCopyUrl?: (url: string) => void;

  /**
   * Callback fired when "Download" action is clicked in MediaCard actions menu.
   *
   * @param media - Media item to download
   */
  onDownload?: (media: Media) => void;

  /**
   * Callback fired when retry button is clicked in error state.
   * Typically calls TanStack Query's refetch function.
   *
   * @example
   * ```tsx
   * const { refetch } = useMedia(params);
   * <MediaGrid onRetry={refetch} />
   * ```
   */
  onRetry?: () => void;

  /**
   * Additional CSS classes to apply to the grid container.
   * Useful for custom spacing or styling.
   *
   * @default ""
   */
  className?: string;

  /**
   * Custom empty state message to display when no media files are found.
   * If not provided, defaults to "Upload new media files using the upload area above to get started."
   *
   * Can be a string or a React node for custom formatting.
   *
   * @example
   * ```tsx
   * <MediaGrid
   *   emptyStateMessage="No media available. Visit /admin/media to upload files."
   * />
   * ```
   */
  emptyStateMessage?: React.ReactNode;
}
