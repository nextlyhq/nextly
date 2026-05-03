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
} from "@revnixhq/ui";

import { AlertTriangle, RotateCcw, Trash } from "@admin/components/icons";

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
// Helpers
// ============================================================================

/**
 * Formats a date as a relative time string (e.g., "2 minutes ago").
 * Simple implementation without external dependencies.
 */
function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();

  // Convert to seconds
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return "just now";
  }

  // Minutes
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return diffMin === 1 ? "1 minute ago" : `${diffMin} minutes ago`;
  }

  // Hours
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
  }

  // Days
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
  }

  // Weeks (for drafts up to 7 days, this handles edge cases)
  const diffWeeks = Math.floor(diffDays / 7);
  return diffWeeks === 1 ? "1 week ago" : `${diffWeeks} weeks ago`;
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
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-none bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500" />
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
