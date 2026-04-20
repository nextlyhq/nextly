/**
 * useDraftRecovery Hook
 *
 * Detects and offers recovery of saved drafts when returning to
 * an entry form. Works in conjunction with useAutoSave.
 *
 * @module hooks/useDraftRecovery
 * @since 1.0.0
 */

import { useState, useEffect, useCallback } from "react";

import { getDraft, clearDraftByKey } from "./useAutoSave";

// ============================================================================
// Types
// ============================================================================

/**
 * Draft data structure.
 */
export interface Draft {
  /** The saved form data */
  data: Record<string, unknown>;
  /** Timestamp when the draft was saved (ms since epoch) */
  savedAt: number;
  /** Timestamp when the draft expires (ms since epoch) */
  expiresAt: number;
}

/**
 * Options for the useDraftRecovery hook.
 */
export interface UseDraftRecoveryOptions {
  /**
   * Storage key for the draft.
   * Should match the key used by useAutoSave.
   */
  storageKey: string;

  /**
   * Current form data to compare against.
   * If provided and different from draft, recovery dialog is shown.
   */
  currentData?: Record<string, unknown>;

  /**
   * Called when user chooses to recover the draft.
   * Should update form state with the recovered data.
   */
  onRecover: (data: Record<string, unknown>) => void;

  /**
   * Called when user dismisses the recovery dialog.
   */
  onDismiss?: () => void;

  /**
   * Whether draft recovery is enabled.
   * @default true
   */
  enabled?: boolean;
}

/**
 * Return type for useDraftRecovery hook.
 */
export interface UseDraftRecoveryReturn {
  /** Whether a recoverable draft exists */
  hasDraft: boolean;
  /** The draft data if available */
  draft: Draft | null;
  /** Whether the recovery dialog should be shown */
  showRecoveryDialog: boolean;
  /** Recover the draft (applies data and clears draft) */
  recover: () => void;
  /** Dismiss the dialog and clear the draft */
  dismiss: () => void;
  /** Clear the draft without showing dialog */
  clearDraft: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Simple deep equality check for form data.
 * Handles common cases for form values.
 */
function isDataEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  // Quick reference check
  if (a === b) return true;

  // Check key counts
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  // Compare each key
  for (const key of keysA) {
    const valA = a[key];
    const valB = b[key];

    // Handle null/undefined
    if (valA === null && valB === null) continue;
    if (valA === undefined && valB === undefined) continue;
    if (valA === null || valB === null) return false;
    if (valA === undefined || valB === undefined) return false;

    // Handle arrays
    if (Array.isArray(valA) && Array.isArray(valB)) {
      if (valA.length !== valB.length) return false;
      // Simple stringification for array comparison
      if (JSON.stringify(valA) !== JSON.stringify(valB)) return false;
      continue;
    }

    // Handle objects (recursive)
    if (typeof valA === "object" && typeof valB === "object") {
      if (
        !isDataEqual(
          valA as Record<string, unknown>,
          valB as Record<string, unknown>
        )
      ) {
        return false;
      }
      continue;
    }

    // Primitive comparison
    if (valA !== valB) return false;
  }

  return true;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useDraftRecovery - Detects and offers recovery of saved drafts
 *
 * When a user returns to an entry form with a saved draft that differs
 * from the current data, this hook shows a recovery dialog allowing
 * them to restore their unsaved work.
 *
 * @example Basic usage
 * ```tsx
 * const { showRecoveryDialog, draft, recover, dismiss } = useDraftRecovery({
 *   storageKey: `posts-${entryId}`,
 *   currentData: entry,
 *   onRecover: (data) => {
 *     form.reset(data);
 *   },
 * });
 *
 * return (
 *   <>
 *     {draft && (
 *       <DraftRecoveryDialog
 *         open={showRecoveryDialog}
 *         savedAt={new Date(draft.savedAt)}
 *         onRecover={recover}
 *         onDiscard={dismiss}
 *       />
 *     )}
 *     <form>...</form>
 *   </>
 * );
 * ```
 */
export function useDraftRecovery({
  storageKey,
  currentData,
  onRecover,
  onDismiss,
  enabled = true,
}: UseDraftRecoveryOptions): UseDraftRecoveryReturn {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);

  // ---------------------------------------------------------------------------
  // Check for draft on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const storedDraft = getDraft(storageKey);

    if (!storedDraft) {
      return;
    }

    // Check if draft is different from current data
    if (currentData) {
      const isDifferent = !isDataEqual(storedDraft.data, currentData);
      if (isDifferent) {
        setDraft(storedDraft);
        setShowRecoveryDialog(true);
      } else {
        // Draft matches current data, clear it silently
        clearDraftByKey(storageKey);
      }
    } else {
      // No current data (create mode), show recovery if draft exists
      // Check if draft has meaningful data (not just empty defaults)
      const hasData = Object.values(storedDraft.data).some(value => {
        if (value === null || value === undefined || value === "") return false;
        if (Array.isArray(value) && value.length === 0) return false;
        if (typeof value === "object" && Object.keys(value).length === 0)
          return false;
        return true;
      });

      if (hasData) {
        setDraft(storedDraft);
        setShowRecoveryDialog(true);
      } else {
        // Empty draft, clear it
        clearDraftByKey(storageKey);
      }
    }
    // Reason: only re-run when storageKey or enabled changes; currentData and
    // onRecover are captured at mount — re-running on every parent render would
    // re-trigger the recovery dialog unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, enabled]);

  // ---------------------------------------------------------------------------
  // Recover draft
  // ---------------------------------------------------------------------------

  const recover = useCallback(() => {
    if (draft) {
      onRecover(draft.data);
      clearDraftByKey(storageKey);
      setDraft(null);
      setShowRecoveryDialog(false);
    }
  }, [draft, storageKey, onRecover]);

  // ---------------------------------------------------------------------------
  // Dismiss dialog and clear draft
  // ---------------------------------------------------------------------------

  const dismiss = useCallback(() => {
    clearDraftByKey(storageKey);
    setDraft(null);
    setShowRecoveryDialog(false);
    onDismiss?.();
  }, [storageKey, onDismiss]);

  // ---------------------------------------------------------------------------
  // Clear draft without dialog
  // ---------------------------------------------------------------------------

  const clearDraft = useCallback(() => {
    clearDraftByKey(storageKey);
    setDraft(null);
    setShowRecoveryDialog(false);
  }, [storageKey]);

  return {
    hasDraft: draft !== null,
    draft,
    showRecoveryDialog,
    recover,
    dismiss,
    clearDraft,
  };
}
