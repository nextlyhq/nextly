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
import { Database, Plus } from "lucide-react";
import React from "react";

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
    <div className="rounded-md bg-card border border-border p-12 text-center border-dashed">
      {/* Icon */}
      <div className="flex justify-center mb-4">
        <div className="rounded-full bg-accent p-3">
          <Database
            className="h-6 w-6 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
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
          <Button className="inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create Collection
          </Button>
        </Link>
      )}
    </div>
  );
};

CollectionsEmptyState.displayName = "CollectionsEmptyState";
