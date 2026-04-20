/**
 * Entry Form Actions Component
 *
 * Renders the form action buttons: Preview, Cancel, and Save.
 * Handles loading states and disabled conditions.
 *
 * @module components/entries/EntryForm/EntryFormActions
 * @since 1.0.0
 */

import { Button } from "@revnixhq/ui";

import { Eye, Loader2 } from "@admin/components/icons";

import type { EntryFormMode } from "./useEntryForm";

// ============================================================================
// Types
// ============================================================================

export interface EntryFormActionsProps {
  /** Form mode - affects button labels */
  mode: EntryFormMode;
  /** Whether form is being submitted */
  isSubmitting?: boolean;
  /** Whether form has validation errors */
  isInvalid?: boolean;
  /** Whether cancel button should be shown */
  showCancel?: boolean;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Form ID to associate submit button with */
  formId?: string;
  /** Whether preview is available for this collection */
  isPreviewAvailable?: boolean;
  /** Preview button handler */
  onPreview?: () => void;
  /** Custom label for the preview button */
  previewLabel?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * EntryFormActions - Form submit, cancel, and preview buttons
 *
 * Displays action buttons for the entry form:
 * - Preview: Opens entry preview (if configured)
 * - Cancel: Navigates away from the form
 * - Save/Create: Submits the form
 *
 * Button labels are dynamic based on mode:
 * - Create mode: "Create {singularLabel}"
 * - Edit mode: "Save Changes"
 *
 * @example Basic usage
 * ```tsx
 * <EntryFormActions
 *   mode="create"
 *   singularLabel="Post"
 *   isSubmitting={isSubmitting}
 *   onCancel={handleCancel}
 * />
 * ```
 *
 * @example With preview
 * ```tsx
 * <EntryFormActions
 *   mode="edit"
 *   singularLabel="Post"
 *   isSubmitting={isSubmitting}
 *   onCancel={handleCancel}
 *   isPreviewAvailable={true}
 *   onPreview={openPreview}
 *   previewLabel="Preview Post"
 * />
 * ```
 */
export function EntryFormActions({
  mode,
  isSubmitting = false,
  isInvalid = false,
  showCancel = true,
  onCancel,
  formId = "entry-form",
  isPreviewAvailable = false,
  onPreview,
  previewLabel = "Preview",
}: EntryFormActionsProps) {
  const submitLabel = mode === "create" ? `Create` : "Save Changes";

  const submittingLabel = mode === "create" ? "Creating..." : "Saving...";

  return (
    <div className="flex flex-col gap-2.5 w-full">
      <div className="flex items-center gap-3 w-full">
        {/* Secondary Actions */}
        {(showCancel || isPreviewAvailable) && (
          <div className="flex items-center gap-2 flex-1">
            {isPreviewAvailable && onPreview && (
              <Button
                type="button"
                variant="outline"
                onClick={onPreview}
                disabled={isSubmitting}
                className="flex-1 shadow-none bg-background border-border hover-unified"
              >
                <Eye className="mr-2 h-4 w-4" />
                {previewLabel}
              </Button>
            )}

            {showCancel && onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isSubmitting}
                className="flex-1 shadow-none bg-background border-border hover-unified"
              >
                Cancel
              </Button>
            )}
          </div>
        )}

        {/* Primary Action */}
        <Button
          type="submit"
          form={formId}
          disabled={isSubmitting || isInvalid}
          className="flex-1 shadow-none bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {submittingLabel}
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </div>
  );
}
