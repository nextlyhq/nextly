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
  /** How many columns the dashboard is currently drawn in. */
  columnCount: number;
  /** The counts a reader may choose between. */
  columnChoices: readonly number[];
  onColumnCount: (columnCount: number) => void;
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
  columnCount,
  columnChoices,
  onColumnCount,
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
      {/* 🔴 A RADIO GROUP, not a select. Three or four short, mutually
          exclusive choices are what radios are for: every option is visible
          without opening anything, the arrow keys move between them, and the
          current one is announced. A select hides the alternatives behind a
          click and reads its own value rather than the set.

          Labelled by a real element rather than an `aria-label` on the group,
          so the name is visible to everyone rather than only to a screen
          reader deciding what this cluster of numbers is for. */}
      <div
        role="radiogroup"
        aria-labelledby="dashboard-columns-label"
        className="mr-auto flex items-center gap-1"
        data-testid="dashboard-column-picker"
      >
        <span
          id="dashboard-columns-label"
          className="mr-1 text-xs text-muted-foreground"
        >
          Columns
        </span>
        {columnChoices.map(choice => (
          <Button
            key={choice}
            type="button"
            role="radio"
            aria-checked={choice === columnCount}
            variant={choice === columnCount ? "secondary" : "ghost"}
            size="sm"
            disabled={isSaving}
            onClick={() => onColumnCount(choice)}
            // The count is in the label because the digit alone does not say
            // what it counts, and a reader arriving on it by keyboard has no
            // surrounding context to read.
            aria-label={`${choice} columns`}
            data-testid={`dashboard-column-choice-${choice}`}
          >
            {choice}
          </Button>
        ))}
      </div>

      {canReset ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={isSaving}
          className="text-muted-foreground"
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
