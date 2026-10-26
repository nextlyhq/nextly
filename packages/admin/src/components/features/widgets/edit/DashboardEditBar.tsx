"use client";

/**
 * The dashboard's customise controls: enter, add, reset, abandon, commit.
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
import type { JSX, ReactNode } from "react";

import * as Icons from "@admin/components/icons";

/** A ref callback that registers an element as a place focus can be sent. */
type Register = (element: HTMLElement | null) => void;

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
   * bar. Every control that writes is disabled on it: each of them starts a
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
  /** Open the add panel. */
  onAddWidget: () => void;
  /** Registers Add widget, where focus returns when the add panel closes with nothing added. */
  addWidgetRef?: Register;
  /** Registers the bar, where focus lands as customise mode opens. */
  barRef: Register;
  /** Registers the Customize button, where focus returns as it closes. */
  customizeRef: Register;
  /**
   * What the bar says under its controls: why the last save did not land.
   * Inside the bar, so the reason stays in view with the controls that act on
   * it while the reader scrolls the cards.
   */
  children?: ReactNode;
}

/** The bar's title: short where the bar is one phone's width, so Cancel and Save fit beside it. */
function BarTitle() {
  return (
    // A paragraph, not a heading: the page keeps ONE level-one heading, the
    // welcome's, and this names a mode rather than a section of the outline.
    <p className="order-2 min-w-0 flex-1 text-center text-sm font-semibold text-foreground @min-[640px]/dashboard:text-left">
      <span className="@min-[640px]/dashboard:hidden">Customizing</span>
      <span className="hidden @min-[640px]/dashboard:inline">
        Customizing your dashboard
      </span>
    </p>
  );
}

/** The marker that says the draft differs from the saved one. */
function UnsavedMarker() {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      data-testid="dashboard-edit-unsaved"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-warning" />
      Unsaved changes
    </span>
  );
}

/**
 * What the reader is looking at, said in words. A staged reset draws the default and writes
 * nothing, so the bar says how to keep it and how to go back; otherwise it says how this mode
 * works.
 */
function BarHint({ isResetStaged }: { isResetStaged: boolean }) {
  return (
    <p
      className="text-xs text-muted-foreground"
      data-testid="dashboard-edit-status"
    >
      {isResetStaged ? (
        "Showing the default dashboard. Save to keep it, or Cancel to go back to yours."
      ) : (
        <>
          {/* The handles are drawn only where dragging is on: at one column, the menu alone. */}
          <span className="@min-[640px]/dashboard:hidden">
            Use a card&apos;s menu to move, resize or remove it.
          </span>
          <span className="hidden @min-[640px]/dashboard:inline">
            Drag a card by its handle, or use its menu.
          </span>{" "}
          Only you see this layout.
        </>
      )}
    </p>
  );
}

/**
 * The line under the title: whether the draft differs from the saved one, and the hint. A row of
 * its own across the bar where the bar is one phone's width.
 */
function BarStatus({
  hasUnsavedChanges,
  isResetStaged,
}: {
  hasUnsavedChanges: boolean;
  isResetStaged: boolean;
}) {
  return (
    <div className="order-4 flex basis-full flex-wrap items-center justify-center gap-x-2 @min-[640px]/dashboard:justify-start">
      {hasUnsavedChanges ? <UnsavedMarker /> : null}
      <BarHint isResetStaged={isResetStaged} />
    </div>
  );
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
  onAddWidget,
  addWidgetRef,
  barRef,
  customizeRef,
  children,
}: DashboardEditBarProps): JSX.Element {
  if (!isEditing) {
    return (
      <>
        {/* Offered at every width: on one column the card menu does everything a drag does. */}
        <div className="flex justify-end" data-testid="dashboard-edit-offer">
          <Button
            ref={customizeRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={onBegin}
            // 🔴 Beginning an edit is not itself a write, and it still has to
            // wait for one. The draft is seeded from the arrangement in hand,
            // including the VERSION it will later be saved against -- so a
            // draft opened while a dismissal is settling carries a guard that
            // is about to go stale, and the reader's own Save comes back as a
            // conflict somebody else caused.
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
        {children}
      </>
    );
  }

  return (
    // A labelled group that takes focus as customise mode opens, so a
    // keyboard or screen-reader user lands on the controls of the mode they
    // just entered rather than wherever the Customize button used to be.
    // Focusable only programmatically (`-1`), as a landing place.
    //
    // Sticky at the top of the dashboard's scroll area, so Save and Cancel are
    // in reach however far down the cards the reader has gone. The cards keep
    // a scroll margin to match (`ArrangedCell`), so a control taking focus is
    // never scrolled in under it.
    <div
      ref={barRef}
      role="group"
      aria-label="Customize your dashboard"
      tabIndex={-1}
      className="sticky top-0 z-20 space-y-3 rounded-lg border border-border bg-card px-5 py-3 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="dashboard-edit-bar"
    >
      {/* One column: Cancel leading, a short title, Save trailing; the unsaved marker and the
          hint on a row of their own beneath, the full width, rather than squeezed between the two
          buttons; then Add widget and Reset, as an edit mode's bar is laid out on a phone. Wider:
          the title over the marker and hint, then every action on one row. Switched at the
          dashboard's own one-column width (the `@container/dashboard` 640 px band), the width
          that turns dragging off, so the bar and the hint change with it. Below it the title's
          block is `contents`, so the title and the status line each take their own place in the
          row. The DOM keeps the wide order, which the keyboard follows. */}
      <div className="flex flex-wrap items-center gap-2 @min-[640px]/dashboard:gap-x-4">
        <div className="contents @min-[640px]/dashboard:order-1 @min-[640px]/dashboard:mr-auto @min-[640px]/dashboard:block @min-[640px]/dashboard:min-w-0">
          <BarTitle />
          <BarStatus
            hasUnsavedChanges={hasUnsavedChanges}
            isResetStaged={isResetStaged}
          />
        </div>

        <div className="order-5 flex basis-full flex-wrap items-center gap-2 @min-[640px]/dashboard:order-2 @min-[640px]/dashboard:basis-auto">
          {/* Opens the add panel, which only stages cards in the draft, so it
              waits for no write. */}
          <Button
            ref={addWidgetRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddWidget}
            aria-haspopup="dialog"
            data-testid="dashboard-edit-add"
          >
            <Icons.Plus aria-hidden className="mr-2 size-4" />
            Add widget
          </Button>

          {/* Offered only when there IS an arrangement to reset: a reader
              already on the default has nothing to reset, and a button that
              does nothing is worse than no button. It asks first, and even
              then only stages the default. "Reset" on screen; its name says
              what it resets to, and starts with the word that is shown. */}
          {canReset ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReset}
              // Left enabled once a reset is staged: staging it again is
              // harmless, and disabling the control the dialog returns focus
              // to would drop the reader's focus on `body` as it closed.
              disabled={isWriting}
              aria-label="Reset to default"
              data-testid="dashboard-edit-reset"
            >
              <Icons.RotateCcw aria-hidden className="mr-2 size-4" />
              Reset
            </Button>
          ) : null}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isWriting}
          className="order-1 @min-[640px]/dashboard:order-3"
          data-testid="dashboard-edit-cancel"
        >
          <Icons.X aria-hidden className="mr-2 size-4" />
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          // Disabled with nothing to save, so pressing it cannot spend a
          // write — and a write is not free here: it is guarded, so a
          // pointless one can still come back a conflict and send the
          // reader to reload for nothing.
          disabled={isWriting || !hasUnsavedChanges}
          className="order-3 @min-[640px]/dashboard:order-4"
          data-testid="dashboard-edit-save"
        >
          <Icons.Check aria-hidden className="mr-2 size-4" />
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
      {children}
    </div>
  );
}
