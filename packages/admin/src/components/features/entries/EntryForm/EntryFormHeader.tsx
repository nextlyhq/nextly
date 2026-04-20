/**
 * Entry Form Header Component
 *
 * Displays the form header with title and action dropdown menu.
 * Actions include Show JSON and delete operations (edit mode only).
 *
 * @module components/entries/EntryForm/EntryFormHeader
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

import { MoreHorizontal, Trash2, Loader2, Code } from "@admin/components/icons";

import { AutoSaveIndicator } from "./AutoSaveIndicator";
import { ShowJSONDialog } from "./ShowJSONDialog";
import type { EntryData, EntryFormMode } from "./useEntryForm";

// ============================================================================
// Types
// ============================================================================

export interface EntryFormHeaderProps {
  /** Form mode - 'create' or 'edit' */
  mode: EntryFormMode;
  /** Singular label for the collection (e.g., "Post", "User") */
  singularLabel: string;
  /** Collection slug for API requests */
  collectionSlug: string;
  /** Entry data (for edit mode) */
  entry?: EntryData | null;
  /** Handler for delete action */
  onDelete?: () => void;
  /** Whether delete operation is in progress */
  isDeleting?: boolean;
  /** Whether form is embedded (modal) - hides header in this mode */
  embedded?: boolean;
  /** Auto-save state */
  autoSave?: {
    lastSavedAt: Date | null;
    isSaving: boolean;
  };
  /** Whether form has unsaved changes */
  isDirty?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * EntryFormHeader - Form header with title and actions
 *
 * Displays:
 * - Title based on mode ("Create Post" or "Edit Post")
 * - Header actions (Save/Cancel) passed as children
 * - Actions dropdown with delete (edit mode only)
 *
 * Destructive actions are in a dropdown menu rather than prominently
 * displayed, preventing accidental clicks.
 *
 * @example
 * ```tsx
 * <EntryFormHeader
 *   mode="edit"
 *   singularLabel="Post"
 *   entry={entry}
 *   onDelete={handleDelete}
 *   isDeleting={isDeleting}
 * />
 * ```
 */
export function EntryFormHeader({
  mode,
  singularLabel,
  collectionSlug,
  entry,
  onDelete,
  isDeleting = false,
  embedded = false,
  autoSave,
  isDirty = false,
}: EntryFormHeaderProps) {
  // Don't render header in embedded mode (modal)
  if (embedded) {
    return null;
  }

  const title =
    mode === "create" ? `Create ${singularLabel}` : `Edit ${singularLabel}`;

  const showActions = mode === "edit" && entry;

  return (
    <div className="flex items-center justify-between mb-6 gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {mode === "edit" && entry?.id && (
          <p className="text-sm text-muted-foreground mt-1">ID: {entry.id}</p>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {autoSave && (
          <div className="flex items-center text-xs mr-2">
            <AutoSaveIndicator
              lastSavedAt={autoSave.lastSavedAt}
              isSaving={autoSave.isSaving}
              isDirty={isDirty}
            />
          </div>
        )}
        {showActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                disabled={isDeleting}
                aria-label="More actions"
                className="shadow-none"
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-4 w-4 text-foreground/70" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 shadow-none">
              {/* Show JSON - always available in edit mode */}
              <ShowJSONDialog
                collectionSlug={collectionSlug}
                entryId={entry.id}
                trigger={
                  <DropdownMenuItem onSelect={e => e.preventDefault()}>
                    <Code className="mr-2 h-4 w-4" />
                    Show JSON
                  </DropdownMenuItem>
                }
              />
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onDelete}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
