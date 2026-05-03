/**
 * SinglesEmptyState Component
 *
 * Empty state component for Singles page.
 * Shows contextual message and CTA based on whether user is searching or viewing empty list.
 *
 * ## Design Specifications
 * - Icon: Globe icon in circular accent background (representing global/site-wide settings)
 * - Hierarchy: Headline > Description > CTA (optional)
 * - Spacing: 48px padding, 8px grid system
 * - Typography: text-lg headline, text-sm description
 *
 * ## Accessibility
 * - Icon is decorative (aria-hidden="true")
 * - Proper heading hierarchy
 * - Clear text hierarchy for screen readers
 *
 * @example
 * ```tsx
 * // No data state (show CTA)
 * <SinglesEmptyState isSearching={false} />
 *
 * // No search results (no CTA)
 * <SinglesEmptyState isSearching={true} />
 * ```
 */

import { Button } from "@revnixhq/ui";
import { Globe, Plus } from "lucide-react";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

export interface SinglesEmptyStateProps {
  /**
   * Whether the user is currently searching (affects message and CTA visibility)
   */
  isSearching?: boolean;
}

/**
 * SinglesEmptyState Component
 *
 * Displays an empty state for the Singles table with contextual messaging.
 */
export const SinglesEmptyState: React.FC<SinglesEmptyStateProps> = ({
  isSearching = false,
}) => {
  return (
    <div className="rounded-none bg-card  border border-primary/5 p-12 text-center border-dashed">
      {/* Icon */}
      <div className="flex justify-center mb-4">
        <div className="rounded-none bg-accent p-3">
          <Globe className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
      </div>

      {/* Headline */}
      <h3 className="text-lg font-semibold text-foreground mb-2">
        {isSearching ? "No Singles found" : "No Singles yet"}
      </h3>

      {/* Description */}
      <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
        {isSearching
          ? "No Singles match your search. Try adjusting your search terms or filters."
          : "Get started by creating your first Single to manage site-wide settings like headers, footers, and navigation."}
      </p>

      {/* CTA (only show when not searching/filtering) */}
      {!isSearching && (
        <Link href={ROUTES.SINGLES_BUILDER}>
          <Button className="inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create Single
          </Button>
        </Link>
      )}
    </div>
  );
};

SinglesEmptyState.displayName = "SinglesEmptyState";
