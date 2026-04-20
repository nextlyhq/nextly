/**
 * MediaLibrarySkeleton Component
 *
 * Loading skeleton for the Media Library page.
 * Displays placeholder UI while media items are being fetched.
 *
 * Follows design system specifications:
 * - Responsive grid: 2 columns (mobile) → 4 columns (tablet) → 6 columns (desktop)
 * - Grid gap: 16px (gap-4)
 * - Card aspect ratio: 1:1 (aspect-square)
 * - Uses Skeleton component from design system
 *
 */

import { Skeleton } from "@revnixhq/ui";

import { MEDIA_GRID_CLASSES } from "@admin/constants/media";

/**
 * MediaLibrarySkeleton component props
 */
export interface MediaLibrarySkeletonProps {
  /**
   * Number of skeleton cards to display
   * @default 12
   */
  count?: number;

  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * MediaLibrarySkeleton component
 *
 * Displays a grid of skeleton cards matching the MediaGrid layout.
 *
 * ## Design Specifications
 *
 * - **Grid Layout**: Responsive 2-6 columns
 *   - Mobile (< 768px): 2 columns
 *   - Tablet (768-1024px): 4 columns
 *   - Desktop (≥ 1024px): 6 columns
 * - **Grid Gap**: 16px (gap-4)
 * - **Card Aspect Ratio**: 1:1 (aspect-square)
 * - **Animation**: Pulse animation via Skeleton component
 *
 * ## Accessibility
 *
 * This component includes `role="status"` and `aria-label="Loading media"` attributes
 * to announce loading state to screen readers. The parent container should add
 * `aria-busy="true"` for optimal accessibility:
 *
 * - **Component provides**: `role="status"` and `aria-label="Loading media"`
 * - **Parent should add**: `aria-busy="true"` to indicate loading state
 * - **Skeleton components**: Use `aria-hidden="true"` automatically
 *
 * This separation allows proper ARIA semantics without duplication:
 * - `role="status"` announces loading to screen readers
 * - `aria-busy="true"` marks the container as busy during loading
 * - `aria-label` provides descriptive text for the loading state
 *
 * @example
 * ```tsx
 * // Basic usage (component provides role="status" and aria-label)
 * <MediaLibrarySkeleton />
 *
 * // Custom count
 * <MediaLibrarySkeleton count={6} />
 *
 * // Recommended: Parent adds aria-busy for optimal accessibility
 * <div aria-busy="true">
 *   <MediaLibrarySkeleton />
 * </div>
 * ```
 */
export function MediaLibrarySkeleton({
  count = 12,
  className = "",
}: MediaLibrarySkeletonProps) {
  return (
    <div
      className={`${MEDIA_GRID_CLASSES} ${className}`}
      role="status"
      aria-label="Loading media"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="space-y-3">
          {/* Card image skeleton */}
          <Skeleton className="aspect-square w-full rounded-lg" />

          {/* Card filename skeleton */}
          <Skeleton className="h-4 w-3/4" />

          {/* Card metadata skeleton */}
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
