"use client";

/**
 * MediaBulkActionBar Component
 *
 * A clean, simple bulk action bar for the media library.
 * Shows only Delete and Clear actions with a nice UI.
 *
 * ## Features
 *
 * - Fixed position at bottom of screen
 * - Smooth slide-up animation
 * - Delete and Clear actions only
 * - Loading state during deletion
 * - Responsive design
 * - WCAG 2.2 AA compliant
 */

import { Button } from "@revnixhq/ui";

import { FolderInput, Trash2, X } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

export interface MediaBulkActionBarProps {
  /**
   * Number of media items selected
   */
  selectedCount: number;

  /**
   * Callback when Delete is clicked
   */
  onDelete: () => void;

  /**
   * Callback when Move to Folder is clicked
   */
  onMoveToFolder: () => void;

  /**
   * Callback when Clear selection is clicked
   */
  onClear: () => void;

  /**
   * Whether delete operation is in progress
   * @default false
   */
  isDeleting?: boolean;

  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * MediaBulkActionBar Component
 *
 * Simple bulk action bar for media library with Delete and Clear actions.
 */
export function MediaBulkActionBar({
  selectedCount,
  onDelete,
  onMoveToFolder,
  onClear,
  isDeleting = false,
  className,
}: MediaBulkActionBarProps) {
  const itemLabel = selectedCount === 1 ? "item" : "items";

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions for selected media"
      aria-live="polite"
      className={cn(
        "flex items-center justify-between gap-4 w-full p-3 rounded-xl border border-primary/20 bg-primary/5 animate-in fade-in slide-in-from-top-2 duration-300",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 items-center gap-2 px-3">
          <span className="text-sm font-semibold text-primary">
            {selectedCount}
          </span>
          <span className="text-xs text-muted-foreground font-normal">
            {itemLabel} selected
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Clear selection button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={isDeleting}
          className="text-muted-foreground hover:text-foreground h-8 text-xs font-normal"
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
          Clear
        </Button>

        <div className="h-4 w-px bg-primary/20 mx-1" />

        {/* Move to folder button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onMoveToFolder}
          disabled={isDeleting}
          className="gap-1.5 h-8 text-xs font-normal bg-white dark:bg-slate-950 border-primary/20 text-primary hover:bg-primary/5"
        >
          <FolderInput className="h-3.5 w-3.5" />
          Move
        </Button>

        {/* Delete button - Black and White scheme */}
        <Button
          variant="default"
          size="sm"
          onClick={onDelete}
          disabled={isDeleting}
          className="h-8 text-xs font-normal px-4 bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          aria-label={`Delete ${selectedCount} selected ${itemLabel}`}
        >
          {isDeleting ? (
            <>
              <span className="mr-1.5 h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Deleting...
            </>
          ) : (
            <>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
