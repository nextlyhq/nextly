"use client";

/**
 * Everything that surrounds the grid while a reader is customising it: the
 * controls, the two questions it asks first, and the messages a failed save
 * or an unreadable stored layout produce.
 *
 * Together because they are one subject — the state of the CUSTOMISATION,
 * rather than of any card.
 *
 * @module components/features/widgets/edit/DashboardEditChrome
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@nextlyhq/ui";
import type { JSX } from "react";
import { useState } from "react";

import * as Icons from "@admin/components/icons";

import { DashboardEditBar } from "./DashboardEditBar";
import type { DashboardFocus } from "./useDashboardFocus";
import type { LayoutEditor } from "./useLayoutEditor";
import type { SaveRequest } from "./useSaveRequest";

export interface DashboardEditChromeProps {
  editor: LayoutEditor;
  /** A write that failed for a reason other than losing a race. */
  writeError: Error | null;
  /**
   * Whether an arrangement has been read. Customising is offered only then: a
   * write echoes a version and a scope token, and neither exists until a read
   * lands.
   */
  hasArrangement: boolean;
  /** Whether this reader has an arrangement of their own to reset. */
  canReset: boolean;
  /** Whether the stored arrangement could not be read. */
  isUnreadable: boolean;
  /** Stage the default dashboard in the draft, once the reader agreed. */
  onStageReset: () => void;
  /**
   * Opening and leaving customise mode, and going to the widgets on offer.
   * The arrangement's own, rather than the editor's, because they also say
   * what happened and move focus.
   */
  on: { begin: () => void; cancel: () => void; addWidget: () => void };
  /** Saving, which over an unreadable stored layout asks first. */
  saveRequest: SaveRequest;
  /** Where the bar and the Customize button register for focus. */
  focus: Pick<DashboardFocus, "barRef" | "customizeRef" | "addWidgetRef">;
}

/** One of the two questions this chrome asks before acting. */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  keep,
  onConfirm,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirm: string;
  keep: string;
  onConfirm: () => void;
  testId: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid={testId}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* No handler: closing IS the refusal. */}
          <AlertDialogCancel>{keep}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Said above the grid whenever the stored arrangement could not be read: the
 * reader is looking at the default, and Save is what replaces the stored one.
 *
 * Not a live region: it describes the page as it loaded rather than something
 * that just happened, and the grid keeps ONE region for those.
 */
function UnreadableNotice() {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
      data-testid="dashboard-unreadable"
    >
      <Icons.AlertTriangle
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <span>
        Your saved dashboard couldn&apos;t be loaded, so you&apos;re seeing the
        default. Saving from Customize replaces the saved one.
      </span>
    </div>
  );
}

/**
 * Why the last save did not land, and the one thing to do about it.
 *
 * Drawn inside the bar, beside the controls it is about. Not a live region:
 * the grid keeps ONE, and it already says what happened, so an alert here
 * would read the same failure a second time, assertively, over it.
 */
function SaveProblem({
  editor,
  writeError,
  onRetry,
}: {
  editor: LayoutEditor;
  writeError: Error | null;
  onRetry: () => void;
}) {
  if (editor.isConflict) {
    // Both guards refuse the same way and the remedy is the same, so this is
    // one message rather than two. It does NOT clear the draft: the reader's
    // work stays on screen while they decide.
    return (
      <div
        className="flex flex-wrap items-start gap-3 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm"
        data-testid="dashboard-edit-conflict"
      >
        <Icons.AlertTriangle
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-warning"
        />
        <p className="min-w-0 flex-1">
          Your dashboard changed somewhere else while you were customizing it.
          Reload to pick up the current arrangement — your unsaved changes here
          will be lost.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={editor.reload}
          data-testid="dashboard-edit-reload"
        >
          Reload
        </Button>
      </div>
    );
  }

  if (!writeError) return null;
  // The remedy differs from a conflict's: this one is retried, not reloaded,
  // so the arrangement stays exactly where it is. Full-strength
  // `border-destructive`, which every other error surface uses; a faded
  // border falls under the 3:1 a non-decorative border needs.
  return (
    <div
      className="flex flex-wrap items-start gap-3 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm"
      data-testid="dashboard-edit-error"
    >
      <Icons.XCircle
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <p className="min-w-0 flex-1">
        Your dashboard could not be saved. Your changes are still here — try
        again in a moment.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={editor.isWriting}
        data-testid="dashboard-edit-retry"
      >
        Try again
      </Button>
    </div>
  );
}

export function DashboardEditChrome({
  editor,
  writeError,
  hasArrangement,
  canReset,
  isUnreadable,
  onStageReset,
  on,
  saveRequest,
  focus,
}: DashboardEditChromeProps): JSX.Element {
  const [askingReset, setAskingReset] = useState(false);
  const requestSave = () => void saveRequest.request();

  return (
    <>
      {hasArrangement ? (
        <DashboardEditBar
          isEditing={editor.isEditing}
          hasUnsavedChanges={editor.hasUnsavedChanges}
          isResetStaged={editor.isResetStaged}
          isSaving={editor.isSaving}
          isWriting={editor.isWriting}
          canReset={canReset}
          onBegin={on.begin}
          onSave={requestSave}
          onCancel={on.cancel}
          onReset={() => setAskingReset(true)}
          onAddWidget={on.addWidget}
          addWidgetRef={focus.addWidgetRef}
          barRef={focus.barRef}
          customizeRef={focus.customizeRef}
        >
          <SaveProblem
            editor={editor}
            writeError={writeError}
            onRetry={requestSave}
          />
        </DashboardEditBar>
      ) : null}

      <ConfirmDialog
        open={askingReset}
        onOpenChange={setAskingReset}
        title="Reset to the default dashboard?"
        description="Your cards, widths and settings will be replaced."
        confirm="Reset dashboard"
        keep="Keep my layout"
        onConfirm={onStageReset}
        testId="dashboard-reset-ask"
      />
      {/* 🔴 Over an unreadable stored layout, Save first asks. The server
          refuses a save over that row unless it says the reader confirmed,
          and this is the one place that may say so. */}
      <ConfirmDialog
        open={saveRequest.askingReplace}
        onOpenChange={saveRequest.setAskingReplace}
        title="Replace your saved dashboard?"
        description="It couldn't be loaded, and saving replaces it with this layout."
        confirm="Replace and save"
        keep="Cancel"
        onConfirm={saveRequest.confirmReplace}
        testId="dashboard-replace-ask"
      />

      {isUnreadable ? <UnreadableNotice /> : null}
    </>
  );
}
