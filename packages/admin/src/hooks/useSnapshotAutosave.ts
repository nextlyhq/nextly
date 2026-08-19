"use client";

/**
 * The recording machinery behind autosave, with no opinion about what is being
 * recorded.
 *
 * Debounce, coalescing, the in-flight guard, the mounted guard, the latch that
 * stops asking once the server has refused, and the status an indicator reads:
 * all of it is the same whether the thing being recorded is a form's values or
 * a block document, and none of it needs to know which.
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

/**
 * A refusal the server will give again, told apart from a failure that may not.
 *
 * Recording is opt-in per entity and enforced on the server, so an entity whose
 * owner has not enabled it answers every request the same way. Asking again on
 * the next debounce produces one rejected request every couple of seconds for
 * as long as the editor is open, which is the shape this predicate exists to
 * stop — and the same is true of a caller who simply may not write this
 * document.
 *
 * Keyed on the status rather than on a reason string. The reason the server
 * logs (`autosave-not-enabled`) stays in its log context and never reaches the
 * client, and a client that pattern-matched a message would be reading prose
 * that is free to change.
 *
 * The 4xx class carries the distinction that matters — a 4xx is an answer about
 * this request, while a 5xx or a dropped connection is not an answer at all —
 * minus the four statuses that HTTP defines as answers which can change on
 * their own. Those are not exceptions to the rule; they are the part of the
 * class that fails the test the rule is made of.
 */
const RETRYABLE_CLIENT_STATUSES = new Set([
  /*
   * The admin refreshes an expired access token and retries underneath this
   * module, so a 401 usually never surfaces at all. It surfaces when the
   * REFRESH itself fails for a non-auth reason — a 5xx, a dropped connection —
   * and the original 401 propagates. Latching there would stop recording for
   * the rest of a session whose credentials were never actually rejected.
   */
  401,
  // A timeout, an early send and a rate limit are all "not now" rather than
  // "no", and the next debounce is exactly the later moment they ask for.
  408, 425, 429,
]);

function isRefusal(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return false;
  return (
    status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.has(status)
  );
}

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

/**
 * Whether a recording must NOT be made.
 *
 * One question with one implementation, asked at flush and only there. Checking
 * any of these at scheduling time as well reads as defensive and is worse than
 * redundant: `enabled` moves while a timer is already pending — it goes false
 * the moment a real save starts — so the answer then is not the answer that
 * matters, and two copies of the rule would eventually disagree about a
 * recording one of them had already allowed.
 */
function recordingBlocked(state: {
  identity: string | null;
  enabled: boolean;
  refused: boolean;
}): boolean {
  return state.identity === null || !state.enabled || state.refused;
}

/**
 * What a failed attempt means: whether the server has settled the question, and
 * what an indicator should show for it.
 *
 * A refusal shows as `idle` rather than `error`, because an entity whose owner
 * never turned recording on has not failed at anything. An indicator stuck on
 * "Couldn't save" would report a policy as a fault, over an editor whose work
 * is not at risk in the way that reads.
 */
function outcomeOfFailure(error: unknown): {
  refused: boolean;
  status: AutosaveStatus;
} {
  return isRefusal(error)
    ? { refused: true, status: "idle" }
    : { refused: false, status: "error" };
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
   * Set once the server has refused, and cleared only by a change of identity.
   * A ref rather than state because nothing renders differently for it: the
   * status it leaves behind is `idle`, which is what an editor with no
   * recording available should show.
   */
  const refusedRef = useRef(false);

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
    if (
      recordingBlocked({
        identity: identityRef.current,
        enabled: enabledRef.current,
        refused: refusedRef.current,
      })
    )
      return;

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
    } catch (error) {
      /*
       * Swallowed deliberately, and reported through `status` rather than
       * thrown. A recovery point nobody asked for must not surface an error
       * over the editor or interrupt typing; the next debounce tries again —
       * unless the server refused, and then there is nothing to try again.
       *
       * A refusal shows as `idle` rather than `error`, because an entity whose
       * owner never turned recording on has not failed at anything. An
       * indicator stuck on "Couldn't save" would report a policy as a fault,
       * over an editor whose work is not at risk in the way that reads.
       */
      const outcome = outcomeOfFailure(error);
      refusedRef.current = outcome.refused;
      if (mountedRef.current) setStatus(outcome.status);
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
    // A refusal belongs to the document it was given for. Another document is
    // another entity with its own setting and its own access, so the answer is
    // asked again rather than inherited.
    refusedRef.current = false;
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [identity]);

  return { status, lastSavedAt, schedule };
}
