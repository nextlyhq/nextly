/**
 * Single Form Actions Component
 *
 * Action buttons for the Single edit form.
 * Includes Save button, Cancel button, and auto-save indicator.
 *
 * Unlike EntryFormActions, this component:
 * - Has no mode (always "edit")
 * - Has no preview functionality (Singles don't have preview URLs)
 * - Simpler layout
 *
 * @module components/singles/SingleFormActions
 * @since 1.0.0
 */

import { Button } from "@revnixhq/ui";

import { Loader2, Save } from "@admin/components/icons";

// ============================================================================
// Types
// ============================================================================

export interface SingleFormActionsProps {
  /** Whether the form is currently submitting */
  isSubmitting: boolean;
  /** Handler for cancel action */
  onCancel?: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * SingleFormActions - Action buttons for Single form
 *
 * Displays:
 * - Save button (primary action)
 * - Cancel button (secondary action)
 * - Auto-save indicator showing draft status
 *
 * @example
 * ```tsx
 * <SingleFormActions
 *   isSubmitting={isPending}
 *   onCancel={() => navigate(-1)}
 *   autoSave={{
 *     lastSavedAt: new Date(),
 *     isSaving: false,
 *   }}
 *   isDirty={form.formState.isDirty}
 * />
 * ```
 */
export function SingleFormActions({
  isSubmitting,
  onCancel,
}: SingleFormActionsProps) {
  return (
    <div className="flex flex-col gap-2.5 w-full">
      {/* Action buttons */}
      <div className="flex items-center gap-3 w-full">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 shadow-none bg-background border-primary/5 hover-unified"
          >
            Cancel
          </Button>
        )}

        <Button
          size="md" 
          type="submit"
          disabled={isSubmitting}
          className="flex-1 shadow-none bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
