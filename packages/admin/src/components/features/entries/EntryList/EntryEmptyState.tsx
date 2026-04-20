/**
 * Entry Empty State Component
 *
 * Displayed when a collection has no entries yet.
 * Provides a clear call-to-action to create the first entry.
 *
 * @module components/entries/EntryList/EntryEmptyState
 * @since 1.0.0
 */

import { Button } from "@revnixhq/ui";

import { FileText, Plus } from "@admin/components/icons";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the EntryEmptyState component.
 */
export interface EntryEmptyStateProps {
  /** Plural name of the collection (e.g., "Posts", "Users") */
  collectionName: string;
  /** Singular name of the collection (e.g., "Post", "User") */
  singularName: string;
  /** Callback when create button is clicked */
  onCreateClick: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Empty state component for collections with no entries.
 *
 * Features:
 * - Visually distinct empty state with icon
 * - Clear messaging about the empty collection
 * - Prominent call-to-action button
 * - Accessible with proper semantic structure
 *
 * @param props - Empty state props
 * @returns Empty state component
 *
 * @example
 * ```tsx
 * <EntryEmptyState
 *   collectionName="Posts"
 *   singularName="Post"
 *   onCreateClick={() => navigate('/collections/posts/create')}
 * />
 * ```
 */
export function EntryEmptyState({
  collectionName,
  singularName,
  onCreateClick,
}: EntryEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 border border-dashed rounded-lg bg-card rounded-md">
      <div className="rounded-full bg-muted p-4 mb-4">
        <FileText className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-1">
        No {collectionName.toLowerCase()} yet
      </h3>
      <p className="text-muted-foreground text-center max-w-sm mb-6">
        Get started by creating your first {singularName.toLowerCase()}.
      </p>
      <Button onClick={onCreateClick}>
        <Plus className="mr-2 h-4 w-4" />
        Create {singularName}
      </Button>
    </div>
  );
}
