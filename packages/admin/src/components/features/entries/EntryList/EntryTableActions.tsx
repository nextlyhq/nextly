/**
 * Entry Table Actions Component
 *
 * Provides row-level actions for entries in the list view.
 * Includes edit and delete actions.
 *
 * @module components/entries/EntryList/EntryTableActions
 * @since 1.0.0
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@revnixhq/ui";

import { MoreHorizontal, Pencil, Trash2 } from "@admin/components/icons";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the EntryTableActions component.
 */
export interface EntryTableActionsProps {
  /** ID of the entry */
  entryId: string;
  /** Callback when edit action is triggered */
  onEdit: (entryId: string) => void;
  /** Callback when delete action is triggered */
  onDelete: (entryId: string) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Row actions dropdown for entry table.
 *
 * Provides a consistent action menu with:
 * - Edit: Opens entry edit form
 * - Delete: Removes the entry (with confirmation)
 *
 * @param props - Actions props with callbacks
 * @returns Dropdown menu with entry actions
 *
 * @example
 * ```tsx
 * <EntryTableActions
 *   entryId="123"
 *   onEdit={(id) => router.push(`/entries/${id}`)}
 *   onDelete={(id) => deleteEntry.mutate(id)}
 * />
 * ```
 */
export function EntryTableActions({
  entryId,
  onEdit,
  onDelete,
}: EntryTableActionsProps) {
  return (
    // Stop propagation to prevent React portal event bubbling from reaching
    // the parent TableRow's onClick handler (which navigates to edit page).
    // React propagates portal events through the component tree, not the DOM tree,
    // so without this, clicking a dropdown menu item would also trigger row navigation.
    <div data-actions onClick={e => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="md"
            className="h-8 w-8 p-0"
            aria-label="Open actions menu"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(entryId)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onDelete(entryId)}
            className="text-black focus:text-black"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
