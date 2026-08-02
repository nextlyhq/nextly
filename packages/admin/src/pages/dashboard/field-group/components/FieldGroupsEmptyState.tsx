/**
 * FieldGroupsEmptyState Component
 *
 * Empty state component for Field Groups page.
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
 * <FieldGroupsEmptyState isSearching={false} />
 *
 * // No search results (no CTA)
 * <FieldGroupsEmptyState isSearching={true} />
 * ```
 */

import { Button } from "@nextlyhq/ui";
import { Puzzle, Plus } from "lucide-react";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

export interface FieldGroupsEmptyStateProps {
  /**
   * Whether the user is currently searching (affects message and CTA visibility)
   */
  isSearching?: boolean;
}

/**
 * FieldGroupsEmptyState Component
 *
 * Displays an empty state for the Field Groups table with contextual messaging.
 */
export const FieldGroupsEmptyState: React.FC<FieldGroupsEmptyStateProps> = ({
  isSearching = false,
}) => {
  return (
    <div className="rounded-lg bg-card  border border-border p-12 text-center">
      {/* Icon */}
      <div className="flex justify-center mb-6">
        <Puzzle className="h-10 w-10 text-primary/30" aria-hidden="true" />
      </div>

      {/* Headline */}
      <h3 className="text-lg font-semibold text-foreground mb-2">
        {isSearching ? "No field groups found" : "No field groups yet"}
      </h3>

      {/* Description */}
      <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
        {isSearching
          ? "No field groups match your search. Try adjusting your search terms or filters."
          : "Get started by creating your first reusable field group to share across your collections."}
      </p>

      {/* CTA (only show when not searching/filtering) */}
      {!isSearching && (
        <Link href={ROUTES.BUILDER_FIELD_GROUPS_NEW}>
          <Button size="md">
            <Plus className="h-4 w-4" />
            Create Field Group
          </Button>
        </Link>
      )}
    </div>
  );
};

FieldGroupsEmptyState.displayName = "FieldGroupsEmptyState";
