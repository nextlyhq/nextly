/**
 * Draft Recovery Dialog Component
 *
 * Prompts the user to recover or discard a previously saved draft
 * when returning to an entry form with unsaved changes.
 *
 * @module components/entries/EntryForm/DraftRecoveryDialog
 * @since 1.0.0
 */

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@nextlyhq/ui";

import { AlertTriangle, RotateCcw, Trash } from "@admin/components/icons";

import { formatTimeAgo } from "./time-ago";

// ============================================================================
// Types
// ============================================================================

export interface DraftRecoveryDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** When the draft was saved */
  savedAt: Date;
  /** Called when user chooses to recover the draft */
  onRecover: () => void;
  /** Called when user chooses to discard the draft */
  onDiscard: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * DraftRecoveryDialog - Prompts user to recover or discard saved draft
 *
 * Shows when a user returns to a form with previously auto-saved changes.
 * Provides options to recover the draft data or start fresh.
 *
 * @example
 * ```tsx
 * <DraftRecoveryDialog
 *   open={showRecoveryDialog}
 *   savedAt={new Date(draft.savedAt)}
 *   onRecover={() => {
 *     form.reset(draft.data);
 *     setShowRecoveryDialog(false);
 *   }}
 *   onDiscard={() => {
 *     clearDraft();
 *     setShowRecoveryDialog(false);
 *   }}
 * />
 * ```
 */
export function DraftRecoveryDialog({
  open,
  savedAt,
  onRecover,
  onDiscard,
}: DraftRecoveryDialogProps) {
  const timeAgo = formatTimeAgo(savedAt);

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-warning-100 dark:bg-warning-900/30">
              <AlertTriangle className="h-5 w-5 text-warning-600 dark:text-warning-500" />
            </div>
            <div className="space-y-1">
              <AlertDialogTitle>Recover unsaved changes?</AlertDialogTitle>
              <AlertDialogDescription>
                We found a draft that was saved {timeAgo}. Would you like to
                recover these changes or start fresh?
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <AlertDialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onDiscard}>
            <Trash className="h-4 w-4" />
            Discard draft
          </Button>
          <Button onClick={onRecover}>
            <RotateCcw className="h-4 w-4" />
            Recover changes
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
