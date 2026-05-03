/**
 * CollectionsEmptyState Component
 *
 * Empty state component for Collections page.
 * Shows contextual message and CTA based on whether user is searching or viewing empty list.
 *
 * ## Design Specifications
 * - Icon: Database icon in circular accent background
 * - Hierarchy: Headline → Description → CTA (optional)
 * - Spacing: 48px padding, 8px grid system
 * - Typography: text-lg headline, text-sm description
 * - Colors: Blue-cyan palette from design system
 *
 * ## Accessibility
 * - Icon is decorative (aria-hidden="true")
 * - Proper heading hierarchy
 * - Clear text hierarchy for screen readers
 *
 * @example
 * ```tsx
 * // No data state (show CTA)
 * <CollectionsEmptyState isSearching={false} />
 *
 * // No search results (no CTA)
 * <CollectionsEmptyState isSearching={true} />
 * ```
 */

import { Button } from "@revnixhq/ui";
import { Layers, Plus } from "lucide-react";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

export interface CollectionsEmptyStateProps {
  /**
   * Whether the user is currently searching (affects message and CTA visibility)
   */
  isSearching?: boolean;
}

/**
 * CollectionsEmptyState Component
 *
 * Displays an empty state for the Collections table with contextual messaging.
 */
export const CollectionsEmptyState: React.FC<CollectionsEmptyStateProps> = ({
  isSearching = false,
}) => {
  return (
    <div className="rounded-none bg-card  border border-primary/5 p-12 text-center">
      {/* Icon */}
      <div className="flex justify-center mb-6">
        <Layers className="h-10 w-10 text-primary/30" aria-hidden="true" />
      </div>

      {/* Headline */}
      <h3 className="text-lg font-semibold text-foreground mb-2">
        {isSearching ? "No collections found" : "No collections yet"}
      </h3>

      {/* Description */}
      <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
        {isSearching
          ? "No collections match your search. Try adjusting your search terms or filters."
          : "Get started by creating your first collection to organize and manage your content."}
      </p>

      {/* CTA (only show when not searching/filtering) */}
      {!isSearching && (
        <Link href={ROUTES.COLLECTIONS_BUILDER}>
          <Button size="md">
            <Plus className="h-4 w-4" />
            Create Collection
          </Button>
        </Link>
      )}
    </div>
  );
};

CollectionsEmptyState.displayName = "CollectionsEmptyState";
