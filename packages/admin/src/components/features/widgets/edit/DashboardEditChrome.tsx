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
} from "@nextlyhq/ui";
import { useState } from "react";

import * as Icons from "@admin/components/icons";

import { DashboardEditBar } from "./DashboardEditBar";
import type { LayoutEditor } from "./useLayoutEditor";

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

export function DashboardEditChrome({
  editor,
  writeError,
  hasArrangement,
  canReset,
  isUnreadable,
  onStageReset,
}: DashboardEditChromeProps) {
  const [askingReset, setAskingReset] = useState(false);
  const [askingReplace, setAskingReplace] = useState(false);

  // 🔴 Over an unreadable stored layout, Save first asks. The server refuses a
  // save over that row unless it says the reader confirmed, and this is the
  // one place that may say so.
  const requestSave = () =>
    isUnreadable ? setAskingReplace(true) : editor.save();

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
          onBegin={editor.begin}
          onSave={requestSave}
          onCancel={editor.cancel}
          onReset={() => setAskingReset(true)}
        />
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
      <ConfirmDialog
        open={askingReplace}
        onOpenChange={setAskingReplace}
        title="Replace your saved dashboard?"
        description="It couldn't be loaded, and saving replaces it with this layout."
        confirm="Replace and save"
        keep="Cancel"
        onConfirm={() => editor.save({ replaceUnreadable: true })}
        testId="dashboard-replace-ask"
      />

      {isUnreadable ? <UnreadableNotice /> : null}

      {editor.isConflict ? (
        // Both guards refuse the same way and the remedy is the same, so this
        // is one message rather than two. It does NOT clear the draft: the
        // reader's work stays on screen while they decide.
        <div
          role="alert"
          className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
          data-testid="dashboard-edit-conflict"
        >
          Your dashboard changed somewhere else while you were customizing it.
          Reload to pick up the current arrangement — your unsaved changes here
          will be lost.{" "}
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
        // The remedy differs from a conflict's: this one is retried, not
        // reloaded, so the arrangement stays exactly where it is. Full-strength
        // `border-destructive`, which every other error surface uses; a faded
        // border falls under the 3:1 a non-decorative border needs.
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm"
          data-testid="dashboard-edit-error"
        >
          Your dashboard could not be saved. Your changes are still here — try
          again in a moment.
        </div>
      ) : null}
    </>
  );
}
