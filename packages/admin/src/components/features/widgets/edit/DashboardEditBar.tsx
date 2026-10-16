"use client";

/**
 * The dashboard's customise controls: enter, commit, abandon, reset.
 *
 * One bar rather than controls scattered across the cards, because entering and
 * leaving customise mode is a decision about the WHOLE arrangement — and
 * because a reader needs one place to look for "how do I get out of this".
 *
 * Entering is offered from the `md` breakpoint up. Below it every card is full
 * width, so an arrangement is a stacked list with little to reorder, and touch
 * drag is where accessibility regressions hide; the arrangement made on a wider
 * screen still applies. The way OUT is not gated: a customisation already in
 * progress keeps its Save, Cancel and Reset at every width, so a window
 * narrowed mid-way never traps the reader in a mode they cannot leave.
 *
 * @module components/features/widgets/edit/DashboardEditBar
 */

import { Button } from "@nextlyhq/ui";

import * as Icons from "@admin/components/icons";

export interface DashboardEditBarProps {
  isEditing: boolean;
  hasUnsavedChanges: boolean;
  /**
   * Whether the draft holds the default dashboard in place of the reader's
   * own. Said in the bar, because nothing is written until they save.
   */
  isResetStaged: boolean;
  isSaving: boolean;
  /**
   * Whether any layout write is in flight, including one begun outside this
   * bar. Every control here is disabled on it: each of them starts a
   * whole-layout write against one cached version, so a second in flight is a
   * conflict the reader caused themselves.
   */
  isWriting: boolean;
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
  isResetStaged,
  isSaving,
  isWriting,
  canReset,
  onBegin,
  onSave,
  onCancel,
  onReset,
}: DashboardEditBarProps) {
  if (!isEditing) {
    return (
      // `hidden md:flex`: a breakpoint in CSS rather than a width read in
      // JavaScript, so the offer cannot disagree with what the page draws.
      // `display: none` also takes the control out of the accessibility tree,
      // so it is not offered to a screen reader either.
      <div
        className="hidden justify-end md:flex"
        data-testid="dashboard-edit-offer"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBegin}
          // 🔴 Beginning an edit is not itself a write, and it still has to
          // wait for one. The draft is seeded from the arrangement in hand,
          // including the VERSION it will later be saved against -- so a draft
          // opened while a dismissal is settling carries a guard that is about
          // to go stale, and the reader's own Save comes back as a conflict
          // somebody else caused.
          disabled={isWriting}
          data-testid="dashboard-edit-begin"
        >
          <Icons.Pencil aria-hidden className="mr-2 size-4" />
          {/* "Customize", the word every message about this mode uses: the
              unreadable-layout notice tells the reader to save "from
              Customize", so the control has to be called that. */}
          Customize
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {/* What the reader is looking at, said in words. A staged reset draws
          the default and writes nothing, so the bar says how to keep it and
          how to go back; otherwise it says how this mode works. */}
      <p
        className="mr-auto text-xs text-muted-foreground"
        data-testid="dashboard-edit-status"
      >
        {isResetStaged
          ? "Showing the default dashboard. Save to keep it, or Cancel to go back to yours."
          : "Drag a card by its handle, or use its menu. Only you see this layout."}
      </p>

      {/* Reset sits apart from Save/Cancel and reads as the destructive one,
          because it replaces an arrangement rather than an edit. Offered only
          when there IS one: a reader already on the default has nothing to
          reset, and a button that does nothing is worse than no button. It
          asks first, and even then only stages the default. */}
      {canReset ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          // Left enabled once a reset is staged: staging it again is harmless,
          // and disabling the control the dialog returns focus to would drop
          // the reader's focus on `body` as the dialog closed.
          disabled={isWriting}
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
        disabled={isWriting}
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
        disabled={isWriting || !hasUnsavedChanges}
        data-testid="dashboard-edit-save"
      >
        {isSaving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
