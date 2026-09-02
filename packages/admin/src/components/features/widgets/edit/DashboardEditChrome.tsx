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
  /**
   * Whether an arrangement has been read. Editing is offered only then: a write
   * echoes a version and a scope token, and neither exists until a read lands.
   */
  hasArrangement: boolean;
  /** Whether this reader has an arrangement of their own to reset. */
  canReset: boolean;
  onReload: () => void;
}

export function DashboardEditChrome({
  editor,
  hasArrangement,
  canReset,
  onReload,
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
            onClick={onReload}
            data-testid="dashboard-edit-reload"
          >
            Reload
          </button>
        </div>
      ) : null}
    </>
  );
}
