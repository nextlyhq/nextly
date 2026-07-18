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
  // Why: Publish / Unpublish are only meaningful for collections with the
  // built-in Draft / Published lifecycle (`status: true`). Hide otherwise
  // so non-status collections keep the existing minimal action set.
  const showPublishActions =
    collection?.status === true && !!onPublish && !!onUnpublish;
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
            Draft / Published lifecycle). Both buttons are always shown
            together when status is enabled — bulk-toggling all selected
            rows to one state is the natural UX for a workflow column. */}
        {showPublishActions && (
          <>
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
