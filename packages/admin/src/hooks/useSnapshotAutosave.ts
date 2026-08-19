"use client";

/**
 * The recording machinery behind autosave, with no opinion about what is being
 * recorded.
 *
 * Debounce, coalescing, the in-flight guard, the mounted guard and the status
 * an indicator reads: all of it is the same whether the thing being recorded is
 * a form's values or a block document, and none of it needs to know which.
 * Splitting it out is what lets a second editor record recovery points without
 * a second implementation of the timing — and two implementations of a debounce
 * that must agree with a status vocabulary is exactly the pair that drifts.
 *
 * ## What this does NOT decide
 *
 * **What a snapshot is, and where it goes.** The caller supplies `save`, so the
 * API surface, the payload shape and the locale all stay with whoever owns
 * them. This module never imports an API client.
 *
 * **When there is something worth recording.** The caller calls `schedule()`.
 * A form knows that from its dirty flag; an editor knows it from its own
 * history. Guessing here would mean a rule that is right for one of them.
 *
 * ## The identity is OPAQUE, deliberately
 *
 * `identity` is compared for change and otherwise never read. It is not a
 * document id, because it is not always one: recovery rows are keyed per
 * document and per author today, and pending changes are becoming per-document
 * and per-LANGUAGE. A core that assumed "one recording per document" would have
 * to be reopened to express that, so it assumes only "one recording per
 * whatever the caller says", which both fit inside.
 *
 * @module hooks/useSnapshotAutosave
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** How long to wait after the last change before recording. */
export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 2000;

/** Where a recording has got to, for an indicator to read. */
export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

/** What a completed recording reports back. */
export interface SnapshotSaveResult {
  /**
   * When the server stored it, by the SERVER's clock.
   *
   * Taken from the response rather than from `Date.now()`, so a "saved 2
   * minutes ago" reading cannot drift with an unsynchronised browser clock.
   */
  updatedAt: string;
}

export interface UseSnapshotAutosaveOptions {
  /**
   * What this recording is keyed by, or `null` when recording must stay off.
   *
   * Compared for change and never inspected. `null` disables recording rather
   * than inventing an address — a document that has never been saved has
   * nothing for the endpoint to write against.
   */
  identity: string | null;

  /**
   * Persist the current snapshot.
   *
   * Called AT flush time, not when it is handed over, so it must read the
   * current value rather than close over one captured earlier. That is the
   * whole reason it is a callback: the caller keeps the freshest copy and this
   * module keeps the timing.
   */
  save: () => Promise<SnapshotSaveResult>;

  /** Milliseconds of quiet before a recording is made. */
  debounceMs?: number;

  /**
   * Turns recording off without unmounting. Used while a real save is in
   * flight: the document is about to change underneath the snapshot, so a
   * recovery point written now would describe a state that never existed.
   */
  enabled?: boolean;
}

export interface UseSnapshotAutosaveResult {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  /**
   * Ask for a recording once the debounce has elapsed.
   *
   * Repeated calls restart the wait rather than queueing, so a burst of typing
   * records once at the end of it.
   */
  schedule: () => void;
}

/**
 * @param options - what to key on, how to persist, and how long to wait
 * @returns the current status, when the last recording landed, and the trigger
 */
export function useSnapshotAutosave({
  identity,
  save,
  debounceMs = DEFAULT_AUTOSAVE_DEBOUNCE_MS,
  enabled = true,
}: UseSnapshotAutosaveOptions): UseSnapshotAutosaveResult {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  /*
   * Set when a change arrives while a recording is still in flight. Those
   * values would otherwise be lost: the timer for them has already fired, and
   * no further change is guaranteed to arrive to schedule another.
   */
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);

  /*
   * Read through refs inside the debounced callback rather than captured as
   * dependencies. The callback is created once per subscription, and closing
   * over these would pin the values they held when it was set up.
   */
  const identityRef = useRef(identity);
  const enabledRef = useRef(enabled);
  const saveRef = useRef(save);
  identityRef.current = identity;
  enabledRef.current = enabled;
  saveRef.current = save;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const flush = useCallback(async () => {
    if (identityRef.current === null || !enabledRef.current) return;

    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }

    inFlightRef.current = true;
    if (mountedRef.current) setStatus("saving");

    try {
      const result = await saveRef.current();
      if (mountedRef.current) {
        setLastSavedAt(new Date(result.updatedAt));
        setStatus("saved");
      }
    } catch {
      /*
       * Swallowed deliberately, and reported through `status` rather than
       * thrown. A recovery point nobody asked for must not surface an error
       * over the editor or interrupt typing; the next debounce tries again.
       */
      if (mountedRef.current) setStatus("error");
    } finally {
      inFlightRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void flush();
      }
    }
  }, []);

  /*
   * Whether to record is decided at FLUSH, and only there.
   *
   * Checking it here as well reads as defensive and is worse than redundant:
   * `enabled` moves while a timer is already pending — it goes false the moment
   * a real save starts — so the answer at scheduling time is not the answer
   * that matters, and two copies of the rule would eventually disagree about a
   * recording one of them had already allowed. Scheduling a timer that flush
   * then declines costs a cleared timeout.
   */
  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flush();
    }, debounceMs);
  }, [flush, debounceMs]);

  // A pending recording belongs to the identity that scheduled it. Left
  // running across a change it would write one document's snapshot against
  // another's key, which is the one failure this module can cause that the
  // caller cannot see.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [identity]);

  return { status, lastSavedAt, schedule };
}
