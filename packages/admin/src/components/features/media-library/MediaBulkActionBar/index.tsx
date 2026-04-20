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
        "fixed bottom-0 right-0 z-40 transition-[left] duration-200 ease-linear",
        "left-0 md:group-data-[state=expanded]/sidebar-wrapper:left-[var(--sidebar-width)] md:group-data-[state=collapsed]/sidebar-wrapper:left-[var(--sidebar-width-icon)]",
        "border-t border-border bg-background shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] backdrop-blur supports-[backdrop-filter]:bg-background/80",
        "animate-in slide-in-from-bottom duration-300",
        className
      )}
    >
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          {/* Left side: Selection info */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 items-center gap-2 rounded-lg bg-primary/10 px-4">
              <span className="text-lg font-semibold text-primary">
                {selectedCount}
              </span>
              <span className="text-sm text-muted-foreground">
                {itemLabel} selected
              </span>
            </div>
          </div>

          {/* Right side: Actions */}
          <div className="flex items-center gap-3">
            {/* Clear selection button */}
            <Button
              variant="ghost"
              size="default"
              onClick={onClear}
              disabled={isDeleting}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="mr-2 h-4 w-4" />
              Clear selection
            </Button>

            {/* Move to folder button */}
            <Button
              variant="outline"
              size="default"
              onClick={onMoveToFolder}
              disabled={isDeleting}
              className="gap-2"
            >
              <FolderInput className="h-4 w-4" />
              Move
            </Button>

            {/* Delete button */}
            <Button
              variant="destructive"
              size="default"
              onClick={onDelete}
              disabled={isDeleting}
              className="min-w-[120px]"
              aria-label={`Delete ${selectedCount} selected ${itemLabel}`}
            >
              {isDeleting ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete {selectedCount > 1 ? `(${selectedCount})` : ""}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
