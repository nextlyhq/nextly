"use client";

/**
 * The dashboard's edit controls: enter, commit, abandon, reset.
 *
 * One bar rather than controls scattered across the cards, because entering and
 * leaving edit mode is a decision about the WHOLE arrangement — and because a
 * reader needs one place to look for "how do I get out of this".
 *
 * @module components/features/widgets/edit/DashboardEditBar
 */

import { Button } from "@nextlyhq/ui";

import * as Icons from "@admin/components/icons";

export interface DashboardEditBarProps {
  isEditing: boolean;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  /** Whether the reader has an arrangement of their own to reset. */
  canReset: boolean;
  onBegin: () => void;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
}

export function DashboardEditBar({
  isEditing,
  hasUnsavedChanges,
  isSaving,
  canReset,
  onBegin,
  onSave,
  onCancel,
  onReset,
}: DashboardEditBarProps) {
  if (!isEditing) {
    return (
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBegin}
          data-testid="dashboard-edit-begin"
        >
          <Icons.Pencil aria-hidden className="mr-2 size-4" />
          Edit dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {/* Reset sits apart from Save/Cancel and reads as the destructive one,
          because it discards an arrangement rather than an edit. Offered only
          when there IS one: a reader already on the default has nothing to
          reset, and a button that does nothing is worse than no button. */}
      {canReset ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={isSaving}
          className="mr-auto text-muted-foreground"
          data-testid="dashboard-edit-reset"
        >
          Reset to default
        </Button>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={isSaving}
        data-testid="dashboard-edit-cancel"
      >
        Cancel
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={onSave}
        // Disabled with nothing to save, so pressing it cannot spend a write —
        // and a write is not free here: it is guarded, so a pointless one can
        // still come back a conflict and send the reader to reload for nothing.
        disabled={isSaving || !hasUnsavedChanges}
        data-testid="dashboard-edit-save"
      >
        {isSaving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
