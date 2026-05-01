/**
 * MediaGrid Component
 *
 * Responsive grid container for displaying media files in the Media Library.
 * Renders MediaCard components in a 2-6 column grid based on viewport size.
 *
 * ## Features
 *
 * - **Responsive Grid**: 2 columns (mobile), 4 columns (tablet), 6 columns (desktop)
 * - **Loading State**: Displays skeleton cards during data fetching
 * - **Empty State**: Clear message with icon when no media files exist
 * - **Error State**: Alert component with retry functionality
 * - **Bulk Selection**: Integrates with useRowSelection hook for multi-select
 * - **Accessibility**: WCAG 2.2 AA compliant (ARIA, keyboard navigation, screen readers)
 *
 * ## Grid Layout
 *
 * - **Mobile (< 768px)**: 2 columns, 16px gap, min 150×150px per card
 * - **Tablet (768px - 1024px)**: 4 columns, 16px gap, min 120×120px per card
 * - **Desktop (≥ 1024px)**: 6 columns, 16px gap, min 120×120px per card
 *
 * ## Design Specifications
 *
 * - Gap: 16px (`gap-4`)
 * - Card aspect ratio: Square (`aspect-square`)
 * - Grid classes: `grid-cols-2 md:grid-cols-4 lg:grid-cols-6`
 * - Loading skeletons: 12 items (DEFAULT_MEDIA_SKELETON_COUNT)
 * - Empty icon: Folder (64px, lucide-react)
 * - Error icon: AlertTriangle (lucide-react, destructive variant)
 *
 * ## Accessibility
 *
 * - **ARIA Roles**: `aria-busy` for loading state, `role="status"` for empty state
 * - **ARIA Labels**: Descriptive labels for all interactive elements
 * - **Keyboard Navigation**: Tab through grid items, Enter to select
 * - **Screen Reader Support**: Live regions for status updates
 * - **Focus Indicators**: 2px primary-500 ring on focus
 * - **Touch Targets**: 44×44px minimum on mobile (WCAG 2.5.5)
 *
 *
 * @example
 * ```tsx
 * // Basic usage (loading state)
 * <MediaGrid
 *   media={[]}
 *   isLoading={true}
 *   error={null}
 *   selectedIds={new Set()}
 *   onSelectionChange={(id) => console.log('Selected:', id)}
 * />
 *
 * // With media items
 * <MediaGrid
 *   media={mediaItems}
 *   isLoading={false}
 *   error={null}
 *   selectedIds={selectedIds}
 *   onSelectionChange={handleSelectionChange}
 *   onItemClick={handleItemClick}
 * />
 *
 * // Error state with retry
 * <MediaGrid
 *   media={[]}
 *   isLoading={false}
 *   error={new Error('Failed to fetch')}
 *   selectedIds={new Set()}
 *   onSelectionChange={(id) => {}}
 *   onRetry={() => refetch()}
 * />
 * ```
 */

import { Alert, AlertDescription, AlertTitle, Button } from "@revnixhq/ui";

import { AlertTriangle, Folder } from "@admin/components/icons";
import {
  DEFAULT_MEDIA_SKELETON_COUNT,
  MEDIA_GRID_CLASSES,
} from "@admin/constants/media";
import type { MediaGridProps } from "@admin/types/ui/media-grid";

import { MediaCard } from "../MediaCard";
import { MediaLibrarySkeleton } from "../MediaLibrarySkeleton";

/**
 * MediaGrid component
 *
 * Responsive grid container for media library files.
 *
 * ## Component States
 *
 * 1. **Loading**: Shows 12 skeleton cards with proper ARIA labels
 * 2. **Empty**: Shows Folder icon with "No media files found" message
 * 3. **Error**: Shows Alert component with retry button
 * 4. **Success**: Renders MediaCard components in responsive grid
 *
 * ## Responsive Behavior
 *
 * - Mobile (< 768px): `grid-cols-2` (2 columns)
 * - Tablet (768px - 1024px): `md:grid-cols-4` (4 columns)
 * - Desktop (≥ 1024px): `lg:grid-cols-6` (6 columns)
 *
 * ## Integration with Bulk Selection
 *
 * - Pass `selectedIds` Set from useRowSelection hook
 * - Pass `onSelectionChange` callback to toggle selection
 * - MediaCard will render checkbox when selection mode is active
 *
 * ## Performance Considerations
 *
 * - Grid uses CSS Grid (hardware accelerated)
 * - No virtualization needed (paginated to 24 items max)
 * - Skeleton prevents layout shift during loading
 *
 * @param props - MediaGridProps
 * @returns Responsive grid of media cards or loading/empty/error states
 */
export function MediaGrid({
  media,
  isLoading = false,
  error = null,
  selectedIds = new Set(),
  onSelectionChange,
  onItemClick,
  onEdit,
  onDelete,
  onCopyUrl,
  onDownload,
  onRetry,
  className = "",
  emptyStateMessage,
}: MediaGridProps) {
  // Loading state: Show skeleton cards
  if (isLoading) {
    return (
      <MediaLibrarySkeleton
        count={DEFAULT_MEDIA_SKELETON_COUNT}
        className={className}
      />
    );
  }

  // Error state: Show alert with retry button
  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Failed to load media files</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <p>
            {error.message ||
              "An error occurred while fetching media files. Please try again."}
          </p>
          {onRetry && (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="w-full sm:w-auto"
              >
                Retry
              </Button>
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  // Empty state: Show message when no media files exist
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
          {emptyStateMessage ?? (
            <>
              Upload new media files using the upload area above to get started.
            </>
          )}
        </p>
      </div>
    );
  }

  // Success state: Render media grid with cards
  return (
    <div className={`${MEDIA_GRID_CLASSES} ${className}`.trim()}>
      {media.map(item => (
        <MediaCard
          key={item.id}
          media={item}
          isSelected={selectedIds.has(item.id)}
          onSelectionChange={onSelectionChange}
          onClick={onItemClick}
          onEdit={onEdit}
          onDelete={onDelete}
          onCopyUrl={onCopyUrl}
          onDownload={onDownload}
        />
      ))}
    </div>
  );
}
