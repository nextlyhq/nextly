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

import { Button, RadioGroup, RadioGroupItem } from "@nextlyhq/ui";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

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
      {/* 🔴 The REAL radio group, not buttons wearing `role="radio"`.
          ARIA roles announce a widget; they do not implement one. Custom
          buttons with those roles leave every choice a separate Tab stop and
          the arrow keys inert, so a keyboard reader meets something that
          claims to be a radio group and does not behave like one -- which is
          worse than a plain set of buttons, because the announcement sets an
          expectation the control then breaks.

          Radix supplies roving focus, arrow-key selection and the checked
          state; this only has to style it and say what it is for. The label is
          a visible element rather than an `aria-label`, so the name of the
          control is available to everyone rather than only to a screen reader
          deciding what a cluster of digits means. */}
      <div className="mr-auto flex items-center gap-2">
        <span
          id="dashboard-columns-label"
          className="text-xs text-muted-foreground"
        >
          Columns
        </span>
        <RadioGroup
          aria-labelledby="dashboard-columns-label"
          value={String(columnCount)}
          onValueChange={value => onColumnCount(Number(value))}
          disabled={isSaving}
          className="flex items-center gap-1"
          data-testid="dashboard-column-picker"
        >
          {columnChoices.map(choice => (
            <label
              key={choice}
              // The whole chip is the target, so the hit area matches what a
              // reader sees rather than a small circle beside it.
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                choice === columnCount
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
              data-testid={`dashboard-column-choice-${choice}`}
            >
              <RadioGroupItem
                value={String(choice)}
                aria-label={`${choice} columns`}
              />
              {choice}
            </label>
          ))}
        </RadioGroup>
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
