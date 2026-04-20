/**
 * useAutoSave Hook
 *
 * Automatically saves form data to localStorage with debouncing.
 * Provides draft persistence to prevent data loss on accidental
 * navigation or browser close.
 *
 * @module hooks/useAutoSave
 * @since 1.0.0
 */

import { useEffect, useRef, useCallback, useState } from "react";

// ============================================================================
// Constants
// ============================================================================

/**
 * localStorage key prefix for draft data.
 * Full key format: `nextly-draft-{storageKey}`
 */
const DRAFT_PREFIX = "nextly-draft-";

/**
 * Draft expiry time in milliseconds (7 days).
 */
const DRAFT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Default debounce delay in milliseconds.
 */
const DEFAULT_DEBOUNCE_MS = 2000;

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the useAutoSave hook.
 */
export interface UseAutoSaveOptions {
  /**
   * Unique key for storing the draft.
   * Typically: `{collectionSlug}-{entryId}` or `{collectionSlug}-new`
   */
  storageKey: string;

  /**
   * Data to auto-save. Should be the current form values.
   */
  data: Record<string, unknown>;

  /**
   * Debounce delay in milliseconds.
   * @default 2000
   */
  debounceMs?: number;

  /**
   * Whether auto-save is enabled.
   * Set to false to temporarily disable (e.g., during submission).
   * @default true
   */
  enabled?: boolean;

  /**
   * Callback when save occurs.
   */
  onSave?: () => void;
}

/**
 * Auto-save state information.
 */
export interface AutoSaveState {
  /** Timestamp of last successful save */
  lastSavedAt: Date | null;
  /** Whether a save is currently in progress */
  isSaving: boolean;
  /** Whether a draft exists in storage */
  hasDraft: boolean;
}

/**
 * Return type for useAutoSave hook.
 */
export interface UseAutoSaveReturn extends AutoSaveState {
  /** Clear the current draft from storage */
  clearDraft: () => void;
  /** Force an immediate save (bypass debounce) */
  forceSave: () => void;
}

/**
 * Structure of draft data stored in localStorage.
 */
interface StoredDraft {
  data: Record<string, unknown>;
  savedAt: number;
  expiresAt: number;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useAutoSave - Automatically saves form data to localStorage
 *
 * Provides draft persistence with the following features:
 * - Debounced saves to avoid excessive writes
 * - 7-day expiry for drafts
 * - Force save capability for beforeunload
 * - Clear draft on successful form submission
 *
 * @example Basic usage
 * ```tsx
 * const formValues = form.watch();
 * const { lastSavedAt, isSaving, clearDraft } = useAutoSave({
 *   storageKey: `posts-${entryId}`,
 *   data: formValues,
 *   enabled: isDirty,
 * });
 *
 * // Clear draft after successful save
 * const handleSubmit = async (data) => {
 *   await saveEntry(data);
 *   clearDraft();
 * };
 * ```
 *
 * @example With beforeunload
 * ```tsx
 * const { forceSave } = useAutoSave({ storageKey, data });
 *
 * useEffect(() => {
 *   const handleBeforeUnload = () => {
 *     if (isDirty) forceSave();
 *   };
 *   window.addEventListener("beforeunload", handleBeforeUnload);
 *   return () => window.removeEventListener("beforeunload", handleBeforeUnload);
 * }, [isDirty, forceSave]);
 * ```
 */
export function useAutoSave({
  storageKey,
  data,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  enabled = true,
  onSave,
}: UseAutoSaveOptions): UseAutoSaveReturn {
  const [state, setState] = useState<AutoSaveState>({
    lastSavedAt: null,
    isSaving: false,
    hasDraft: false,
  });

  const fullStorageKey = `${DRAFT_PREFIX}${storageKey}`;

  // Use refs to avoid stale closures and track save state
  const dataRef = useRef(data);
  const onSaveRef = useRef(onSave);
  const lastSavedDataRef = useRef<string | null>(null);

  const isInitialMount = useRef(true);
  // Keep a serialized snapshot of the last seen data to avoid scheduling
  // saves when the form values object identity changes but the contents
  // remain the same (react-hook-form's `watch()` may return a new object
  // instance on every render).
  const prevSerializedRef = useRef<string | null>(null);
  dataRef.current = data;
  onSaveRef.current = onSave;

  // Debounce timer ref
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Check for existing draft on mount and initialize lastSavedDataRef
  // ---------------------------------------------------------------------------

  useEffect(() => {
    try {
      const stored = localStorage.getItem(fullStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as StoredDraft;
        if (parsed.expiresAt > Date.now()) {
          setState(prev => ({ ...prev, hasDraft: true }));
          lastSavedDataRef.current = JSON.stringify(parsed.data);
        } else {
          // Clean up expired draft
          localStorage.removeItem(fullStorageKey);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }, [fullStorageKey]);

  // ---------------------------------------------------------------------------
  // Save draft function
  // ---------------------------------------------------------------------------

  const saveDraft = useCallback(() => {
    setState(prev => ({ ...prev, isSaving: true }));

    try {
      const currentData = dataRef.current;
      const dataString = JSON.stringify(currentData);

      const draftData: StoredDraft = {
        data: currentData,
        savedAt: Date.now(),
        expiresAt: Date.now() + DRAFT_EXPIRY_MS,
      };

      localStorage.setItem(fullStorageKey, JSON.stringify(draftData));
      lastSavedDataRef.current = dataString;

      setState({
        lastSavedAt: new Date(),
        isSaving: false,
        hasDraft: true,
      });
      // Update the serialized snapshot to the latest saved contents. This
      // prevents immediately re-scheduling a save for unchanged data after
      // a successful save (the parent component may re-render).
      try {
        prevSerializedRef.current = JSON.stringify(dataRef.current);
      } catch {
        // ignore serialization errors
      }
      onSaveRef.current?.();
    } catch (error) {
      console.error("[useAutoSave] Failed to save draft:", error);
      setState(prev => ({ ...prev, isSaving: false }));
    }
  }, [fullStorageKey]);

  // ---------------------------------------------------------------------------
  // Debounced save effect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Skip on initial mount - prevents saving when form first loads
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Attempt to serialize data once safely
    let serialized: string | null = null;
    try {
      serialized = JSON.stringify(data);
    } catch (error) {
      console.warn("[useAutoSave] Data serialization failed:", error);
      // serialized remains null, which will trigger a save fallback
    }

    // Skip if not enabled or if data hasn't changed from what we last saved
    if (
      !enabled ||
      (serialized !== null && serialized === lastSavedDataRef.current)
    ) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Avoid scheduling a save when the content is unchanged from what we last saw.
    // This prevents loops from object identity changes.
    if (serialized !== null && prevSerializedRef.current === serialized) {
      return;
    }

    // Remember the latest serialized snapshot
    if (serialized !== null) prevSerializedRef.current = serialized;

    // Clear existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set new debounced timer
    timerRef.current = setTimeout(() => {
      saveDraft();
    }, debounceMs);

    // Cleanup on unmount or dependency change
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [data, enabled, debounceMs, saveDraft]);

  // ---------------------------------------------------------------------------
  // Clear draft
  // ---------------------------------------------------------------------------

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(fullStorageKey);
      setState(prev => ({
        ...prev,
        hasDraft: false,
        lastSavedAt: null,
      }));
    } catch (error) {
      console.error("[useAutoSave] Failed to clear draft:", error);
    }

    // Also clear any pending timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [fullStorageKey]);

  // ---------------------------------------------------------------------------
  // Force save (immediate, bypass debounce)
  // ---------------------------------------------------------------------------

  const forceSave = useCallback(() => {
    // Clear any pending debounced save
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Save immediately
    saveDraft();
  }, [saveDraft]);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    ...state,
    clearDraft,
    forceSave,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Gets the draft data for a given storage key.
 * Used by useDraftRecovery hook.
 *
 * @param storageKey - The storage key (without prefix)
 * @returns The stored draft or null if not found/expired
 */
export function getDraft(storageKey: string): StoredDraft | null {
  const fullKey = `${DRAFT_PREFIX}${storageKey}`;

  try {
    const stored = localStorage.getItem(fullKey);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as StoredDraft;

    // Check expiry
    if (parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(fullKey);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Clears a draft by storage key.
 *
 * @param storageKey - The storage key (without prefix)
 */
export function clearDraftByKey(storageKey: string): void {
  const fullKey = `${DRAFT_PREFIX}${storageKey}`;
  try {
    localStorage.removeItem(fullKey);
  } catch {
    // Ignore errors
  }
}

/**
 * Cleans up all expired drafts from localStorage.
 * Can be called on app startup to prevent storage bloat.
 */
export function cleanupExpiredDrafts(): void {
  try {
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(DRAFT_PREFIX)) {
        const stored = localStorage.getItem(key);
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as StoredDraft;
            if (parsed.expiresAt <= Date.now()) {
              keysToRemove.push(key);
            }
          } catch {
            // Invalid data, remove it
            keysToRemove.push(key);
          }
        }
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch {
    // Ignore errors
  }
}
