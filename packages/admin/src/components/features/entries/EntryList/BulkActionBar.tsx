/**
 * Bulk Action Bar Component
 *
 * Displays when entries are selected, showing count and available
 * bulk actions.
 *
 * @module components/entries/EntryList/BulkActionBar
 * @since 1.0.0
 */

import { Button } from "@nextlyhq/ui";

import { EyeOff, Send, Trash2, X } from "@admin/components/icons";
import { useCan } from "@admin/hooks/useCan";

import type { CollectionForColumns } from "./EntryTableColumns";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the BulkActionBar component.
 */
export interface BulkActionBarProps {
  /** Number of selected entries */
  selectedCount: number;
  /** Collection configuration (for future field-specific bulk updates) */
  collection?: CollectionForColumns;
  /** Callback for bulk delete action */
  onDelete: () => void;
  /** Callback for bulk update action (optional) */
  onUpdate?: (data: Record<string, unknown>) => void;
  /**
   * Callback for bulk publish (sets `status: 'published'` on every selected
   * entry). Only invoked from the Publish button, which is gated on
   * `collection.status === true`. Caller wires this to the bulk-update
   * mutation.
   */
  onPublish?: () => void;
  /**
   * Callback for bulk unpublish (sets `status: 'draft'`). Same gating as
   * `onPublish` — only relevant for collections that opted into the
   * built-in Draft / Published lifecycle.
   */
  onUnpublish?: () => void;
  /** Whether either Publish or Unpublish bulk action is in flight. */
  isPublishing?: boolean;
  /** Callback to clear selection */
  onClear: () => void;
  /** Singular/plural label used in the selected-count text */
  itemLabel?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Action bar displayed when entries are selected for bulk operations.
 *
 * Surfaces a selected-count display, a "delete selected" button, and
 * a "clear selection" button.
 *
 * @param props - Bulk action bar props
 * @returns Bulk action bar component
 *
 * @example
 * ```tsx
 * <BulkActionBar
 *   selectedCount={5}
 *   collection={collection}
 *   onDelete={() => bulkDelete.mutate(selectedIds)}
 *   onUpdate={(data) => bulkUpdate.mutate({ ids: selectedIds, data })}
 *   onClear={() => setRowSelection({})}
 * />
 * ```
 */
export function BulkActionBar({
  selectedCount,
  collection,
  onDelete,
  onPublish,
  onUnpublish,
  isPublishing = false,
  onClear,
  itemLabel = "entry",
}: BulkActionBarProps) {
  // Publishing is its own permission, distinct from editing, and gated per
  // button rather than together: a user may hold one without the other. The
  // slug is empty when there is no collection, which no permission matches, so
  // the hook stays unconditional (a rule of hooks) and resolves to denied.
  const canPublish = useCan(`publish-${collection?.slug ?? ""}`);
  const canUnpublish = useCan(`unpublish-${collection?.slug ?? ""}`);

  // Publish / Unpublish are only meaningful for collections with the built-in
  // Draft / Published lifecycle (`status: true`), and only offered to a caller
  // permitted to make the transition — matching the server, which refuses it
  // otherwise. Each button is shown independently.
  const showPublish = collection?.status === true && !!onPublish && canPublish;
  const showUnpublish =
    collection?.status === true && !!onUnpublish && canUnpublish;
  const showPublishActions = showPublish || showUnpublish;
  // Pluralize the label. "entry" -> "entries", "category" -> "categories",
  // "collection" -> "collections", "user" -> "users". Already-plural labels
  // (ending in "s") pass through unchanged.
  const pluralLabel = itemLabel.endsWith("s")
    ? itemLabel
    : itemLabel.endsWith("y")
      ? `${itemLabel.slice(0, -1)}ies`
      : `${itemLabel}s`;
  const selectedItemLabel = selectedCount === 1 ? itemLabel : pluralLabel;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex items-center justify-between gap-3 rounded-none border border-border bg-primary/[0.07] px-4 py-2.5"
    >
      {/* Selection info */}
      <span className="text-sm font-medium text-foreground">
        {selectedCount} {selectedItemLabel} selected
      </span>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear selection"
        >
          <X className="h-4 w-4" />
          Clear
        </Button>

        {/* Publish / Unpublish (only for collections with the built-in
            Draft / Published lifecycle, and only the transitions this caller
            is permitted to make). Each is shown on its own permission. */}
        {showPublishActions && (
          <>
            {showUnpublish && (
              <Button
                variant="outline"
                size="sm"
                onClick={onUnpublish}
                disabled={isPublishing}
                className="gap-1.5"
                aria-label="Unpublish selected"
              >
                <EyeOff className="h-4 w-4" />
                Unpublish
              </Button>
            )}
            {showPublish && (
              <Button
                variant="default"
                size="sm"
                onClick={onPublish}
                disabled={isPublishing}
                className="gap-1.5"
                aria-label="Publish selected"
              >
                <Send className="h-4 w-4" />
                Publish
              </Button>
            )}
          </>
        )}

        {/* Delete selected */}
        <Button
          variant="destructive"
          size="sm"
          onClick={onDelete}
          className="gap-1.5"
        >
          <Trash2 className="h-4 w-4" />
          Delete selected
        </Button>
      </div>
    </div>
  );
}
