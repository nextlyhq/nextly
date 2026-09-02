"use client";

/**
 * Everything that surrounds the grid while a reader is arranging it: the edit
 * controls, and the one message a conflict produces.
 *
 * Together because they are one subject — the state of the EDIT, rather than of
 * any card — and because keeping them in the grid put two more conditional
 * branches and two more levels of JSX into a component the complexity gate was
 * already objecting to.
 *
 * @module components/features/widgets/edit/DashboardEditChrome
 */

import { DashboardEditBar } from "./DashboardEditBar";
import type { LayoutEditor } from "./useLayoutEditor";

export interface DashboardEditChromeProps {
  editor: LayoutEditor;
  /** A write that failed for a reason other than losing a race. */
  writeError: Error | null;
  /**
   * Whether an arrangement has been read. Editing is offered only then: a write
   * echoes a version and a scope token, and neither exists until a read lands.
   */
  hasArrangement: boolean;
  /** Whether this reader has an arrangement of their own to reset. */
  canReset: boolean;
}

export function DashboardEditChrome({
  editor,
  writeError,
  hasArrangement,
  canReset,
}: DashboardEditChromeProps) {
  return (
    <>
      {hasArrangement ? (
        <DashboardEditBar
          isEditing={editor.isEditing}
          hasUnsavedChanges={editor.hasUnsavedChanges}
          isSaving={editor.isSaving}
          canReset={canReset}
          onBegin={editor.begin}
          onSave={editor.save}
          onCancel={editor.cancel}
          onReset={editor.reset}
        />
      ) : null}

      {editor.isConflict ? (
        // Both guards refuse the same way and the remedy is the same, so this
        // is one message rather than two. It does NOT clear the draft: the
        // reader's work stays on screen while they decide, because discarding
        // it at the moment they are told to try again is the worst possible
        // time to throw it away.
        //
        // Reload is the editor's OWN recovery rather than a callback passed
        // from the grid. The draft, the failed mutation and the query are three
        // pieces of one state, and only the editor holds all three -- a caller
        // that could reach the query alone refetched an arrangement this
        // component then declined to draw, under an alert that never went away.
        <div
          role="alert"
          className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
          data-testid="dashboard-edit-conflict"
        >
          Your dashboard changed somewhere else while you were editing. Reload
          to pick up the current arrangement — your unsaved changes here will be
          lost.{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={editor.reload}
            data-testid="dashboard-edit-reload"
          >
            Reload
          </button>
        </div>
      ) : null}

      {writeError && !editor.isConflict ? (
        // Reported because it previously was not. Only conflicts were rendered,
        // so a save that failed on a network error, a 500 or an authorization
        // change left the reader in edit mode with the spinner stopped and
        // nothing said — believing their arrangement had been stored. The
        // remedy differs from a conflict's too: this one is retried, not
        // reloaded, so the arrangement stays exactly where it is.
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          data-testid="dashboard-edit-error"
        >
          Your dashboard could not be saved. Your changes are still here — try
          again in a moment.
        </div>
      ) : null}
    </>
  );
}
