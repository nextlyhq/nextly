/**
 * ComponentsEmptyState Component
 *
 * Empty state component for Components page.
 * Shows contextual message and CTA based on whether user is searching or viewing empty list.
 *
 * ## Design Specifications
 * - Icon: Puzzle icon in circular accent background
 * - Hierarchy: Headline -> Description -> CTA (optional)
 * - Spacing: 48px padding, 8px grid system
 * - Typography: text-lg headline, text-sm description
 * - Colors: Follows design system palette
 *
 * ## Accessibility
 * - Icon is decorative (aria-hidden="true")
 * - Proper heading hierarchy
 * - Clear text hierarchy for screen readers
 *
 * @example
 * ```tsx
 * // No data state (show CTA)
 * <ComponentsEmptyState isSearching={false} />
 *
 * // No search results (no CTA)
 * <ComponentsEmptyState isSearching={true} />
 * ```
 */

import { Button } from "@revnixhq/ui";
import { Puzzle, Plus } from "lucide-react";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

export interface ComponentsEmptyStateProps {
  /**
   * Whether the user is currently searching (affects message and CTA visibility)
   */
  isSearching?: boolean;
}

/**
 * ComponentsEmptyState Component
 *
 * Displays an empty state for the Components table with contextual messaging.
 */
export const ComponentsEmptyState: React.FC<ComponentsEmptyStateProps> = ({
  isSearching = false,
}) => {
  return (
    <div className="rounded-none bg-card  border border-primary/5 p-12 text-center border-dashed">
      {/* Icon */}
      <div className="flex justify-center mb-4">
        <div className="rounded-none bg-accent p-3">
          <Puzzle
            className="h-6 w-6 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Headline */}
      <h3 className="text-lg font-semibold text-foreground mb-2">
        {isSearching ? "No components found" : "No components yet"}
      </h3>

      {/* Description */}
      <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
        {isSearching
          ? "No components match your search. Try adjusting your search terms or filters."
          : "Get started by creating your first reusable component to share across your collections."}
      </p>

      {/* CTA (only show when not searching/filtering) */}
      {!isSearching && (
        <Link href={ROUTES.COMPONENTS_BUILDER}>
          <Button className="inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create Component
          </Button>
        </Link>
      )}
    </div>
  );
};

ComponentsEmptyState.displayName = "ComponentsEmptyState";
