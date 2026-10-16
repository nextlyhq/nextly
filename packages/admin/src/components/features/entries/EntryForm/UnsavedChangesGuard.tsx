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
  Button,
} from "@nextlyhq/ui";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
   * Callback fired when the author declines to leave — "Keep Editing", or
   * dismissing the dialog.
   *
   * The counterpart to `onDiscard`, and needed for the same reason: a caller
   * that recorded an intent alongside the navigation has to know the navigation
   * did not happen. Without it the intent survives the refusal, and fires later
   * if the author reaches that destination by some other route.
   */
  /*
   * Explicitly nullable rather than merely optional, which is not a style
   * choice: under `exactOptionalPropertyTypes` an optional prop cannot be
   * handed a `T | undefined`, so every caller holding one has to spread it
   * conditionally — and each of those spreads is a branch in a component that
   * already has plenty. Widening the contract here costs nothing; the callers
   * pass the value they hold.
   */
  onCancel?: (() => void) | undefined;

  /**
   * Offer "Save Changes" beside Discard and Keep Editing, and run this when it
   * is chosen. It answers whether the work was saved: `true` lets the held
   * navigation go ahead, `false` cancels it and closes the prompt, so the
   * page's own message about the failed save is what the author reads next.
   *
   * Optional, and absent for the entry and Single editors, whose prompt is
   * unchanged without it.
   */
  onSave?: () => Promise<boolean>;

  /**
   * Whether to disable the guard.
   * Useful during form submission when navigation should be allowed.
   * @default false
   */
  disabled?: boolean;

  /**
   * The edited document's fields: a view offered on a field type keeps the
   * document only where it applies to them.
   */
  fields?: readonly object[] | undefined;

  /**
   * The form content to render.
   */
  children: ReactNode;
}

// ============================================================================
// Component
// ============================================================================

/**
 * The three choices a caller with a Save action gets, in place of the editors'
 * two.
 *
 * Discard is an outline in the destructive colour, set apart on the left; Keep
 * Editing is the dialog's Cancel, which Radix focuses first, so the choice
 * that loses nothing is where focus starts; Save is the primary. On a phone
 * they stack with Save on top and Keep Editing at the bottom, by `order`
 * rather than by document order, so Tab still runs left to right as drawn on
 * a wider screen.
 */
function SaveableChoices({
  saving,
  onDiscard,
  onSave,
}: {
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:space-x-0">
      {/* An Action, as the editors' Discard is, so Radix closes the dialog
          through `onOpenChange` and the confirmed flag is spent by that close.
          Restyled from the Action's solid fill to an outline. */}
      <AlertDialogAction
        onClick={onDiscard}
        disabled={saving}
        className="order-2 border-destructive bg-background text-destructive hover:bg-destructive/10 sm:order-1 sm:mr-auto"
      >
        Discard Changes
      </AlertDialogAction>
      {/* No handler: closing IS the refusal, as in the editors' prompt. Left
          enabled while a save runs, so a save that never answers cannot hold
          the author in this dialog. */}
      <AlertDialogCancel className="order-3 mt-0 sm:order-2">
        Keep Editing
      </AlertDialogCancel>
      {/* A plain button rather than an Action: an Action closes the dialog on
          click, and this one has to stay open until the save has answered. */}
      <Button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="order-1 sm:order-3"
      >
        {saving ? "Saving…" : "Save Changes"}
      </Button>
    </AlertDialogFooter>
  );
}

/**
 * UnsavedChangesGuard - Protect form from accidental navigation
 *
 * Wraps form content and intercepts navigation attempts when the form
 * has unsaved changes. Shows a confirmation dialog allowing the user
 * to either stay and continue editing, or discard changes and leave; given
 * `onSave`, also to save and then leave.
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
  onCancel,
  onSave,
  disabled = false,
  fields,
  children,
}: UnsavedChangesGuardProps) {
  /*
   * Set only while a save chosen from the prompt lets the held navigation go
   * ahead. The hook reports every confirmed leave to `onConfirmLeave`, and a
   * caller cleaning up on DISCARD must not be told its work was thrown away
   * when it was kept.
   */
  const leavingSaved = useRef(false);
  const { showDialog, confirmLeave, cancelLeave, leaveWithoutWarning } =
    useUnsavedChanges({
      isDirty,
      onConfirmLeave: () => {
        if (!leavingSaved.current) onDiscard?.();
      },
      disabled,
      fields,
    });

  const [saving, setSaving] = useState(false);
  /*
   * Which prompt a save belongs to. Bumped when the author closes the prompt
   * themselves, so a save still running when they chose Keep Editing does not
   * answer a question they have already answered.
   */
  const prompt = useRef(0);

  /*
   * Every exit from this dialog is funnelled through `onOpenChange`, and
   * whether it was a refusal is decided by ONE fact recorded on the way out.
   *
   * Wiring the refusal to the Cancel button instead looks equivalent and is
   * not, in two ways that only a test shows. The button also closes the dialog,
   * so the refusal fires twice. And confirming closes it too — so "Discard
   * changes" reported a refusal as well, dropping the very intent the
   * navigation was carrying, at the one moment it was supposed to be honoured.
   *
   * A ref rather than state: it is read during the close that the same gesture
   * causes, and a state update would not have landed by then.
   */
  const confirmed = useRef(false);

  const handleOpenChange = (open: boolean): void => {
    if (open) return;
    // Read and clear in the same breath, so the flag is spent by exactly the
    // close it describes.
    //
    // Clearing it on OPEN instead does not work, and the reason is easy to miss:
    // this dialog is controlled, so Radix reports a close the author caused but
    // never reports the reopen, which `showDialog` does on its own. The flag
    // would survive the first confirmed navigation — and on the NEXT prompt,
    // "Keep Editing" would take the confirmed path, leaving `cancelLeave`
    // uncalled and the dialog on screen with no way out.
    const wasConfirmed = confirmed.current;
    confirmed.current = false;
    if (wasConfirmed) return;
    prompt.current += 1;
    cancelLeave();
    onCancel?.();
  };

  const handleConfirm = (): void => {
    confirmed.current = true;
    confirmLeave();
  };

  /*
   * Save, then either finish the navigation or cancel it. Both close the
   * prompt without `onOpenChange`, which Radix calls only for a close the
   * author caused, so the confirmed flag is neither set nor needed here.
   *
   * A save that fails or is refused cancels the navigation and reports it as
   * a refusal: the caller learns the navigation did not happen, and the page's
   * own message says why.
   */
  const handleSave = async (): Promise<void> => {
    if (!onSave) return;
    const mine = prompt.current;
    setSaving(true);
    let saved = false;
    try {
      saved = await onSave();
    } catch {
      saved = false;
    } finally {
      setSaving(false);
    }
    if (mine !== prompt.current) return;
    if (!saved) {
      cancelLeave();
      onCancel?.();
      return;
    }
    leavingSaved.current = true;
    try {
      confirmLeave();
    } finally {
      leavingSaved.current = false;
    }
  };

  return (
    <LeaveWithoutWarningContext.Provider value={leaveWithoutWarning}>
      {children}

      <AlertDialog open={showDialog} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          {onSave ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
                {/* The editors' first sentence alone: their closing question
                    asks whether to discard, which reads wrong above a choice
                    that also offers to save. */}
                <AlertDialogDescription>
                  You have unsaved changes that will be lost if you leave this
                  page.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <SaveableChoices
                saving={saving}
                onDiscard={handleConfirm}
                onSave={() => void handleSave()}
              />
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
                <AlertDialogDescription>
                  You have unsaved changes that will be lost if you leave this
                  page. Are you sure you want to discard your changes?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                {/* No handler: closing IS the refusal, and it is reported once
                    from `onOpenChange` rather than from both places. */}
                <AlertDialogCancel>Keep Editing</AlertDialogCancel>
                {/* Hover darkens the fill by one ramp step, not two.
                    `destructive-700` drops the on-color label to 3.70:1 in dark
                    mode, under the 4.5:1 text minimum; `destructive-600` holds
                    5.67:1 dark and 5.92:1 light and still reads as a state
                    change against the resting fill. */}
                <AlertDialogAction
                  onClick={handleConfirm}
                  className="bg-destructive-solid text-destructive-foreground hover:bg-destructive-600"
                >
                  Discard Changes
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </LeaveWithoutWarningContext.Provider>
  );
}
