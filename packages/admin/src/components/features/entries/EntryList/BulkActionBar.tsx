/**
 * Bulk Action Bar Component
 *
 * Displays when entries are selected, showing count and available bulk actions.
 * This is a minimal functional stub - will be enhanced in Task 2.4.
 *
 * @module components/entries/EntryList/BulkActionBar
 * @since 1.0.0
 */

import { Button } from "@revnixhq/ui";

import { Trash2, X } from "@admin/components/icons";

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
 * Current features (stub):
 * - Selected count display
 * - Delete selected button
 * - Clear selection button
 *
 * Planned features (Task 2.4):
 * - Bulk update with field selector
 * - Bulk status change
 * - Bulk export
 * - Confirmation dialogs
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
  onDelete,
  onClear,
  itemLabel = "entry",
}: BulkActionBarProps) {
  const selectedItemLabel =
    selectedCount === 1
      ? itemLabel
      : `${itemLabel}${itemLabel.endsWith("s") ? "" : "s"}`;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/50 px-4 py-3">
      {/* Selection info */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {selectedCount} {selectedItemLabel} selected
        </span>
      </div>

      {/* Actions */}
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="gap-1"
          aria-label="Clear selection"
        >
          <X className="h-4 w-4" />
          Clear
        </Button>

        {/* Delete selected */}
        <Button
          variant="destructive"
          size="sm"
          onClick={onDelete}
          className="gap-1"
        >
          <Trash2 className="h-4 w-4" />
          Delete Selected
        </Button>
      </div>
    </div>
  );
}
