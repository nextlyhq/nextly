/**
 * UnsavedChangesGuard Component
 *
 * A wrapper component that detects unsaved form changes and prompts
 * the user before allowing navigation away from the form.
 *
 * Uses useUnsavedChanges hook to intercept navigation and shows
 * an AlertDialog for confirmation.
 *
 * @module components/entries/EntryForm/UnsavedChangesGuard
 * @since 1.0.0
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
import { createContext, useContext, type ReactNode } from "react";

import { useUnsavedChanges } from "@admin/hooks/useUnsavedChanges";

/**
 * Lets a descendant say "this leave is deliberate" without the guard having to
 * be threaded through as a prop. Defaults to a no-op, so a form rendered
 * outside a guard — an embedded editor in a modal — calls it harmlessly.
 */
const LeaveWithoutWarningContext = createContext<() => void>(() => {});

/**
 * The escape for an action that has already asked the question: discarding
 * changes, or leaving after a save. See `useUnsavedChanges` for why intent has
 * to be stated rather than read off `isDirty`.
 */
export function useLeaveWithoutWarning(): () => void {
  return useContext(LeaveWithoutWarningContext);
}

// ============================================================================
// Types
// ============================================================================

export interface UnsavedChangesGuardProps {
  /**
   * Whether the form has unsaved changes.
   * When true, navigation will trigger a confirmation dialog.
   */
  isDirty: boolean;

  /**
   * Callback fired when user confirms discarding changes.
   * Use this to perform any cleanup before navigation.
   */
  onDiscard?: () => void;

  /**
   * Whether to disable the guard.
   * Useful during form submission when navigation should be allowed.
   * @default false
   */
  disabled?: boolean;

  /**
   * The form content to render.
   */
  children: ReactNode;
}

// ============================================================================
// Component
// ============================================================================

/**
 * UnsavedChangesGuard - Protect form from accidental navigation
 *
 * Wraps form content and intercepts navigation attempts when the form
 * has unsaved changes. Shows a confirmation dialog allowing the user
 * to either stay and continue editing, or discard changes and leave.
 *
 * @example Basic usage
 * ```tsx
 * <UnsavedChangesGuard isDirty={form.formState.isDirty}>
 *   <form onSubmit={handleSubmit}>
 *     <input {...form.register("title")} />
 *     <button type="submit">Save</button>
 *   </form>
 * </UnsavedChangesGuard>
 * ```
 *
 * @example With cleanup callback
 * ```tsx
 * <UnsavedChangesGuard
 *   isDirty={isDirty}
 *   onDiscard={() => {
 *     // Clean up any temporary data
 *     clearDraft();
 *   }}
 * >
 *   {children}
 * </UnsavedChangesGuard>
 * ```
 *
 * @example Disabled during submission
 * ```tsx
 * <UnsavedChangesGuard
 *   isDirty={isDirty}
 *   disabled={isSubmitting}
 * >
 *   {children}
 * </UnsavedChangesGuard>
 * ```
 */
export function UnsavedChangesGuard({
  isDirty,
  onDiscard,
  disabled = false,
  children,
}: UnsavedChangesGuardProps) {
  const { showDialog, confirmLeave, cancelLeave, leaveWithoutWarning } =
    useUnsavedChanges({
      isDirty,
      onConfirmLeave: onDiscard,
      disabled,
    });

  return (
    <LeaveWithoutWarningContext.Provider value={leaveWithoutWarning}>
      {children}

      <AlertDialog
        open={showDialog}
        onOpenChange={open => !open && cancelLeave()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes that will be lost if you leave this page.
              Are you sure you want to discard your changes?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelLeave}>
              Keep Editing
            </AlertDialogCancel>
            {/* Hover darkens the fill by one ramp step, not two.
                `destructive-700` drops the on-color label to 3.70:1 in dark
                mode, under the 4.5:1 text minimum; `destructive-600` holds
                5.67:1 dark and 5.92:1 light and still reads as a state change
                against the resting fill. */}
            <AlertDialogAction
              onClick={confirmLeave}
              className="bg-destructive-solid text-destructive-foreground hover:bg-destructive-600"
            >
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </LeaveWithoutWarningContext.Provider>
  );
}
