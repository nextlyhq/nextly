"use client";

/**
 * useAutosave Hook
 *
 * Writes the author's rolling recovery point on a debounce while they edit.
 *
 * The recovery point is not the document: the server keeps one autosave row per
 * document and author and rewrites it in place, so an editing session costs a
 * single row and the live document, its working draft and its durable history
 * are all untouched. Nothing an autosave writes can change what a reader sees or
 * what publishing would promote, which is what makes it safe to run on a timer
 * while somebody is still typing.
 *
 * The save itself is injected rather than owned here, because the two form
 * owners are not the same shape: the entry editor holds its own mutation while
 * the Single form receives one as a prop. A hook that owned the mutation could
 * only have served one of them.
 *
 * @module hooks/useAutosave
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Long enough that ordinary typing does not produce a request per pause. */
const DEFAULT_DEBOUNCE_MS = 2_000;

/**
 * Ceiling on how long continuous typing can defer a save. Without it a debounce
 * alone never fires for an author who does not pause, which is the session most
 * worth protecting.
 */
const DEFAULT_MAX_WAIT_MS = 30_000;

export type AutosaveStatus =
  | "idle"
  /** Edits are waiting for the debounce; the stored point is behind the form. */
  | "pending"
  | "saving"
  | "saved"
  | "error";

export interface UseAutosaveOptions {
  /**
   * Whether to autosave at all. False on a create form: a recovery point has to
   * attach to a stored record, and there is none until the first save.
   */
  enabled: boolean;
  /**
   * Identifies WHAT is being saved: the document, and the language within it.
   *
   * A pending write belongs to the scope it was armed under. When the editor
   * switches document or language it resets the same mounted form, so a timer
   * armed before the switch would fire against values that now describe a
   * different scope and overwrite that scope's recovery point. Changing this
   * abandons any pending write rather than retargeting it.
   */
  scopeKey: string;
  /**
   * Reads the form's current values.
   *
   * This must be react-hook-form's `getValues`, never `handleSubmit`. Both forms
   * are deliberately configured `mode: "onSubmit"` so validation stays quiet
   * until the author asks to save; routing an autosave through `handleSubmit`
   * would run the validator on a timer and light up inline errors and the
   * top-level toast while they are still mid-field. A recovery point records
   * what the author had, so it is allowed to be incomplete.
   */
  getValues: () => Record<string, unknown>;
  /**
   * Performs the write. Rejects on failure.
   *
   * `keepalive` asks for a transport that survives the page being discarded.
   * It is a hint rather than a guarantee: browsers cap such a request's body,
   * so the caller decides whether this snapshot qualifies.
   */
  save: (
    values: Record<string, unknown>,
    opts?: { keepalive?: boolean }
  ) => Promise<unknown>;
  /** Quiet period after the last edit before saving. */
  debounceMs?: number;
  /** Longest the debounce may defer a save during continuous editing. */
  maxWaitMs?: number;
}

export interface UseAutosaveReturn {
  status: AutosaveStatus;
  /** When the last successful save landed, for the status line. */
  lastSavedAt: Date | null;
  /** The last failure, cleared when a later save succeeds. */
  error: Error | null;
  /**
   * Call once per edit to (re)start the debounce.
   *
   * This is what makes autosave fire more than once, and it is a callback
   * rather than a `revision` prop for a measured reason: `isDirty` turns true
   * on the first edit and stays true, so anything derived from it arms a timer
   * once and never again while the author keeps typing -- but threading a
   * per-keystroke counter through props would re-render the whole editor on
   * every character. A stable callback carries the same signal at no render
   * cost, which matters most on the large record editors this runs inside.
   *
   * The caller decides what counts as an edit, because that is a question about
   * its own form library rather than about autosaving.
   */
  notifyChange: () => void;
  /** Saves immediately, bypassing the debounce. */
  saveNow: () => void;
  /**
   * Drop any queued write without performing it.
   *
   * For the moment the form stops being behind the document -- a successful
   * save, a reset, a discard. A timer left armed across one of those writes
   * values that are already persisted, and stamps them NEWER than the
   * document, so the next visit offers them back as unsaved work.
   */
  cancel: () => void;
}

export function useAutosave({
  enabled,
  scopeKey,
  getValues,
  save,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
}: UseAutosaveOptions): UseAutosaveReturn {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Read through refs so a timer that was armed before the latest render still
  // sends the current values rather than the ones captured when it was set.
  const getValuesRef = useRef(getValues);
  getValuesRef.current = getValues;
  const saveRef = useRef(save);
  saveRef.current = save;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const debounceMsRef = useRef(debounceMs);
  debounceMsRef.current = debounceMs;
  const maxWaitMsRef = useRef(maxWaitMs);
  maxWaitMsRef.current = maxWaitMs;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPendingAtRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const supersededRef = useRef(false);
  const mountedRef = useRef(true);
  // The scope a pending timer was armed under, so a fire can tell whether the
  // editor has moved on since.
  const armedScopeRef = useRef(scopeKey);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    firstPendingAtRef.current = null;

    // The editor moved to another document or language after this was armed.
    // The form has been reset to the new scope's values, so there is nothing
    // left of the old scope's edit to write, and writing the CURRENT values
    // under it would corrupt the new scope's recovery point.
    if (armedScopeRef.current !== scopeKeyRef.current) {
      return;
    }

    // One write at a time. Two saves overlapping on one row can land out of
    // order, which would leave the stored recovery point older than the one it
    // replaced. A save already going out is marked superseded instead, and the
    // loop below picks the newer values up when it returns.
    if (inFlightRef.current) {
      supersededRef.current = true;
      return;
    }

    inFlightRef.current = true;
    void (async () => {
      try {
        if (mountedRef.current) {
          setStatus("saving");
        }
        do {
          supersededRef.current = false;
          await saveRef.current(getValuesRef.current());
        } while (supersededRef.current);

        if (mountedRef.current) {
          setStatus("saved");
          setLastSavedAt(new Date());
          setError(null);
        }
      } catch (caught) {
        // Kept visible rather than retried on a timer: a failure that repeats
        // silently is the state autosave exists to make legible.
        if (mountedRef.current) {
          setStatus("error");
          setError(
            caught instanceof Error ? caught : new Error(String(caught))
          );
        }
        // An edit that arrived while this save was in flight consumed its own
        // timer and is carried only by the superseded flag. Clearing it here
        // would drop that newer snapshot for good if the author has since
        // stopped typing, so re-arm one debounce for it instead of retrying
        // the failure immediately.
        if (supersededRef.current && enabledRef.current) {
          timerRef.current = setTimeout(run, debounceMsRef.current);
        }
      } finally {
        inFlightRef.current = false;
        supersededRef.current = false;
      }
    })();
  }, []);

  const notifyChange = useCallback(() => {
    if (!enabledRef.current) {
      return;
    }

    // A stored point that no longer matches the form must stop reading as
    // "Saved". Without this the header keeps showing the earlier time through
    // the whole quiet period, asserting that work is safe while it is not.
    setStatus(current => (current === "saving" ? current : "pending"));

    armedScopeRef.current = scopeKeyRef.current;

    const now = Date.now();
    if (firstPendingAtRef.current === null) {
      firstPendingAtRef.current = now;
    }

    // The debounce restarts on every edit, so on its own it never fires for an
    // author who does not pause. Capping the delay by how long the oldest
    // unsaved change has already waited bounds that, which is why the ceiling is
    // measured from the first pending edit rather than from this one.
    const waited = now - firstPendingAtRef.current;
    const delay = Math.max(
      0,
      Math.min(debounceMsRef.current, maxWaitMsRef.current - waited)
    );

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(run, delay);
  }, [run]);

  // Discarding the DOCUMENT -- a refresh, a tab close, a navigation the router
  // does not own -- is the case React cleanup cannot cover: it is not
  // guaranteed to run at all during unload, and an ordinary request started
  // there is cancelled with the page. `pagehide` fires for it (including the
  // bfcache path, unlike `unload`), and the keepalive hint is what lets the
  // request outlive the document.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const flushOnHide = () => {
      if (timerRef.current === null || !enabledRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = null;
      void saveRef
        .current(getValuesRef.current(), { keepalive: true })
        .catch(() => {
          // The page is going away; there is nothing left to report it on.
        });
    };

    window.addEventListener("pagehide", flushOnHide);
    return () => window.removeEventListener("pagehide", flushOnHide);
  }, []);

  // Leaving the page with edits still inside the debounce window is exactly the
  // work a recovery point exists to keep, so flush instead of dropping the
  // pending timer. Safe to repeat: the write is idempotent, rewriting the one
  // row rather than adding another.
  useEffect(() => {
    return () => {
      // Through `run` rather than calling `save` directly: a save may still be
      // in flight, and starting a second one here could let the newer snapshot
      // finish first and then be overwritten by the older request. `run` folds
      // it into the serialized loop instead.
      if (timerRef.current !== null && enabledRef.current) {
        run();
      }
    };
  }, [run]);

  // Abandon rather than retarget. Flushing would need the OLD scope's values,
  // and by the time this runs the form has already been reset to the new
  // scope's, so there is nothing correct left to write.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      firstPendingAtRef.current = null;
      // The reported state describes the scope being left, so it cannot carry
      // into the next one. Without this, switching language shows the previous
      // language's "Saved 14:32", or its failure, for a scope in which nothing
      // has run. Guarded because this cleanup also runs on unmount, after the
      // mount tracker has already cleared.
      if (mountedRef.current) {
        setStatus("idle");
        setLastSavedAt(null);
        setError(null);
      }
    };
  }, [scopeKey]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    firstPendingAtRef.current = null;
    supersededRef.current = false;
    // Back to reporting the last successful save rather than pending edits:
    // there are no pending edits now.
    setStatus(current => (current === "pending" ? "saved" : current));
  }, []);

  const saveNow = useCallback(() => {
    if (!enabledRef.current) {
      return;
    }
    run();
  }, [run]);

  return { status, lastSavedAt, error, notifyChange, saveNow, cancel };
}
