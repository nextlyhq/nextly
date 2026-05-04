/**
 * Bulk Delete Dialog Component
 *
 * Confirmation dialog for bulk delete operations on entries.
 * Uses AlertDialog primitives for consistent styling and accessibility.
 *
 * @module components/entries/BulkActions/BulkDeleteDialog
 * @since 1.0.0
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@revnixhq/ui";

import { Loader2 } from "@admin/components/icons";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the BulkDeleteDialog component.
 */
export interface BulkDeleteDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
  /** Number of items to be deleted */
  count: number;
  /** Name of the collection (for display) */
  collectionName: string;
  /** Callback when user confirms deletion */
  onConfirm: () => void;
  /** Whether the delete operation is in progress */
  isLoading?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Confirmation dialog for bulk delete operations.
 *
 * Features:
 * - Clear warning message with item count
 * - Loading state during deletion
 * - Accessible with proper ARIA attributes
 * - Consistent styling with other dialogs
 *
 * @param props - Dialog props
 * @returns Bulk delete confirmation dialog
 *
 * @example
 * ```tsx
 * <BulkDeleteDialog
 *   open={deleteDialogOpen}
 *   onOpenChange={setDeleteDialogOpen}
 *   count={selectedIds.length}
 *   collectionName="Posts"
 *   onConfirm={() => bulkDelete.mutate(selectedIds)}
 *   isLoading={bulkDelete.isPending}
 * />
 * ```
 */
export function BulkDeleteDialog({
  open,
  onOpenChange,
  count,
  collectionName,
  onConfirm,
  isLoading = false,
}: BulkDeleteDialogProps) {
  const itemLabel = count === 1 ? "entry" : "entries";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {count} {itemLabel}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete {count} {itemLabel} from{" "}
            <span className="font-medium">{collectionName}</span>? This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              `Delete ${count} ${itemLabel}`
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
