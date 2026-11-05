/**
 * What an action that stores the editor's work waits for, and what the last
 * one came to.
 *
 * Before Save or Publish stores anything, every surface holding work outside
 * the form commits it (`registerBeforeAction`), and every write the document
 * depends on but does not contain settles (`trackWrite`); a failed one refuses
 * the store, naming it. What the last store came to is kept for the save state.
 *
 * Held in refs where an action reads them after awaiting, when the render it
 * started from is already stale, and where a registration made by an effect
 * must count before the next render.
 *
 * @module components/features/entries/EntryForm/useStoringGate
 */
import { useCallback, useRef, useState } from "react";

import { toast } from "@admin/components/ui";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";

import { MOVED_MESSAGE, submitBusy } from "./submit-outcome";
import type {
  BeforeDocumentAction,
  DocumentActionOutcome,
  StoreReadiness,
} from "./useDocumentActionBindings";

/** What the last storing action came to. */
export type LastStore =
  | { kind: "none" }
  | { kind: "stored"; at: Date }
  | { kind: "failed"; message: string; action: string };

export interface StoringGate {
  registerBeforeAction: (handler: BeforeDocumentAction) => () => void;
  trackWrite: (label: string, write: Promise<unknown>) => void;
  /** Wraps an action that stores the editor's work: it runs once that work is ready. */
  storing: (
    action: string,
    perform: () => Promise<DocumentActionOutcome>
  ) => () => Promise<DocumentActionOutcome>;
  lastStore: LastStore;
  /** Whether a storing action is readying the work or a tracked write is in flight. */
  inFlight: boolean;
  /** Whether a tracked write is still on its way. */
  writesPending: boolean;
  /** The label and message of a tracked write whose latest attempt failed. */
  trackedFailure: { label: string; message: string } | null;
}

/**
 * @param scope Which document, in which language, the gate stores for. What
 *   the last store came to belongs to that scope alone: a failed Publish of one
 *   translation offers its Retry only while that translation is on screen, and
 *   a Retry that ran in another would store, or publish, the wrong one.
 */
/**
 * How many rounds of tracked writes a store waits through. Each round awaits
 * every write pending at its start; a write that starts during one is caught
 * by the next. Writes still starting after this many are a surface that keeps
 * writing, and the store is refused rather than held.
 */
const MAX_WRITE_PASSES = 5;

/**
 * How many times a store readies the work, a handler having found it changed
 * just before the write. Work still changing after this many is refused.
 */
const MAX_READY_PASSES = 3;

const stillWriting: DocumentActionOutcome = {
  ok: false,
  reason: "busy",
  message: "Changes on this page are still being saved. Try again in a moment.",
  beforeWrite: true,
};

/**
 * A store whose editor moved to another document or language while it
 * readied: the form now holds that one's values, and the store would write
 * them into the one it started in, so it writes nothing.
 */
const moved: DocumentActionOutcome = {
  ok: false,
  reason: "refused",
  message: MOVED_MESSAGE,
  beforeWrite: true,
};

/**
 * A store's refusal said by the gate itself, once: it settled after the
 * editor moved, so the Save state, which answers for what is on screen now,
 * doesn't show it.
 */
function reportedAfterMove(
  outcome: Exclude<DocumentActionOutcome, { ok: true }>
): DocumentActionOutcome {
  toast.error(outcome.message, { id: "store-after-move" });
  return { ...outcome, reported: true };
}

/**
 * A storing action started while another readies or stores: it would run the
 * handlers again over the first one's question, and store the work twice.
 */
const storeBusy: DocumentActionOutcome = {
  ok: false,
  reason: "busy",
  message: submitBusy.ok ? "" : submitBusy.message,
  beforeWrite: true,
};

/** What an action comes to when a before-action handler called it off. */
const BEFORE_CANCELLED: DocumentActionOutcome = {
  ok: false,
  reason: "cancelled",
  message: "Cancelled.",
};

/** Whether `error` is an `AbortError`, however it was raised. */
function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function useStoringGate(scope: string): StoringGate {
  const beforeActions = useRef(new Set<BeforeDocumentAction>());
  const registerBeforeAction = useCallback((handler: BeforeDocumentAction) => {
    beforeActions.current.add(handler);
    return () => {
      beforeActions.current.delete(handler);
    };
  }, []);

  const writes = useRef({
    next: 0,
    pending: new Map<number, Promise<unknown>>(),
    // The latest attempt of each change, so an older attempt settling late
    // cannot overrule a newer one.
    latest: new Map<string, number>(),
    failed: new Map<string, string>(),
  });
  // Re-rendered when a tracked write starts or settles, for what reads them.
  const [, setWritesChanged] = useState(0);
  const trackWrite = useCallback((label: string, write: Promise<unknown>) => {
    const tracked = writes.current;
    const key = tracked.next++;
    tracked.pending.set(key, write);
    tracked.latest.set(label, key);
    setWritesChanged(n => n + 1);
    const isLatest = () => tracked.latest.get(label) === key;
    void write
      .then(
        () => {
          if (isLatest()) tracked.failed.delete(label);
        },
        (error: unknown) => {
          if (isLatest()) {
            tracked.failed.set(
              label,
              apiErrorMessage(error, "it couldn't be saved.")
            );
          }
        }
      )
      .finally(() => {
        tracked.pending.delete(key);
        setWritesChanged(n => n + 1);
      });
  }, []);

  /**
   * Every tracked write settled, including one started while an earlier one
   * was being waited for, and none failed: the refusal when one did, or null.
   * Bounded, so writes that keep starting refuse the store rather than hold it
   * forever.
   */
  const writesSettled = async (): Promise<DocumentActionOutcome | null> => {
    for (let pass = 0; writes.current.pending.size > 0; pass++) {
      if (pass === MAX_WRITE_PASSES) return stillWriting;
      await Promise.allSettled([...writes.current.pending.values()]);
    }
    const failure = firstFailure(writes.current.failed);
    return failure === null
      ? null
      : {
          ok: false,
          reason: "refused",
          message: `${failure.label} wasn't saved, so this page wasn't either: ${failure.message}`,
          beforeWrite: true,
        };
  };

  /**
   * Readies the editor's work for an action that stores it: every open edit
   * committed, every tracked write settled and none failed. Answers with the
   * refusal when it is not ready, or null when it is.
   *
   * The handlers run first, so an open edit is committed at once, and the
   * tracked writes are settled after them. A handler that acts on the server
   * for the store (publishing what the document needs) waits for them itself,
   * through `writesSettled`, and does not act when one failed: the store is
   * then refused, and what it did would stand without it. That refusal is the
   * store's answer, though the writes have settled by the time it would ask
   * again: a write retried meanwhile must not let the store go ahead without
   * what the handler did not do.
   */
  const readyOnce = async (
    action: string,
    checks: (() => boolean)[]
  ): Promise<DocumentActionOutcome | null> => {
    let refused: DocumentActionOutcome | null = null;
    try {
      const store: StoreReadiness = {
        writesSettled: async () => {
          const outcome = await writesSettled();
          refused ??= outcome;
          return outcome === null;
        },
        checkBeforeWrite: check => {
          checks.push(check);
        },
      };
      for (const before of [...beforeActions.current]) {
        await before(action, store);
      }
    } catch (error) {
      // A handler that asked the author a question and was told no: the
      // action is cancelled, not failed, so the save state is left as it was
      // and nothing is announced. `AbortError` is the platform's own name for
      // an operation its caller called off.
      if (isAbort(error)) return BEFORE_CANCELLED;
      return {
        ok: false,
        reason: "failed",
        message: apiErrorMessage(error, "An open edit couldn't be committed."),
        beforeWrite: true,
      };
    }
    return refused ?? writesSettled();
  };

  /**
   * Readies the work, then makes each handler's check before the write, with
   * nothing awaited between them and the store: the handlers ran with awaits
   * between them, and a later one's write is settled after an earlier one has
   * judged the work, so the work may have changed since. A check that finds
   * it has runs every handler again, so each judges the work as stored. Work
   * still changing after a few rounds is refused rather than chased.
   */
  const readyToStore = async (
    action: string
  ): Promise<DocumentActionOutcome | null> => {
    for (let pass = 0; pass < MAX_READY_PASSES; pass++) {
      const checks: (() => boolean)[] = [];
      const outcome = await readyOnce(action, checks);
      if (outcome !== null || checks.every(check => check())) return outcome;
    }
    return stillWriting;
  };

  /*
   * What the last storing action came to, for the save state. Busy and
   * cancelled are not answers about the work, so they leave it as it was.
   */
  const [lastStore, setLastStore] = useState<LastStore>({ kind: "none" });
  const [readying, setReadying] = useState(0);
  // Another document or language clears it, and coming back does not bring it
  // back: the answer was about the work as it stood, and that work has since
  // been replaced on screen. Cleared while rendering, so no render offers a
  // stale Retry in the new scope.
  const [scopeShown, setScopeShown] = useState(scope);
  if (scopeShown !== scope) {
    setScopeShown(scope);
    setLastStore({ kind: "none" });
  }
  // This visit to the document and language: a new one each time the scope
  // changes, so going away and coming back is a move too, as the form has
  // started afresh from that language's values in between.
  const currentVisit = useRef({ scope });
  if (currentVisit.current.scope !== scope) currentVisit.current = { scope };
  const record = (
    startedIn: { scope: string },
    action: string,
    outcome: DocumentActionOutcome
  ) => {
    // A store that settles after the scope changed answers for a document no
    // longer on screen.
    if (startedIn !== currentVisit.current) return;
    if (outcome.ok) {
      setLastStore({ kind: "stored", at: new Date() });
    } else if (outcome.reason !== "busy" && outcome.reason !== "cancelled") {
      setLastStore({ kind: "failed", message: outcome.message, action });
    }
  };

  /*
   * Inside the performer, so the control and `run` cannot differ about what
   * a store waits for.
   */
  // One storing action at a time. The control is withheld while one is in
  // flight, but only once that renders, and `run` can be called twice before
  // it does.
  const storingNow = useRef(false);
  const storing =
    (action: string, perform: () => Promise<DocumentActionOutcome>) =>
    async (): Promise<DocumentActionOutcome> => {
      if (storingNow.current) return storeBusy;
      storingNow.current = true;
      const startedIn = currentVisit.current;
      setReadying(n => n + 1);
      try {
        // Readying awaits the editor's work, and the editor can move to
        // another document or language meanwhile: asked once it is ready.
        const outcome =
          (await readyToStore(action)) ??
          (currentVisit.current === startedIn ? await perform() : moved);
        record(startedIn, action, outcome);
        // Refused after a move: nothing on screen shows it, so said here.
        return currentVisit.current === startedIn ||
          outcome.ok ||
          outcome.reason === "busy" ||
          outcome.reason === "cancelled"
          ? outcome
          : reportedAfterMove(outcome);
      } finally {
        storingNow.current = false;
        setReadying(n => n - 1);
      }
    };

  return {
    registerBeforeAction,
    trackWrite,
    storing,
    lastStore,
    inFlight: readying > 0 || writes.current.pending.size > 0,
    writesPending: writes.current.pending.size > 0,
    trackedFailure: firstFailure(writes.current.failed),
  };
}

function firstFailure(
  failed: ReadonlyMap<string, string>
): { label: string; message: string } | null {
  const first = failed.entries().next();
  return first.done === true
    ? null
    : { label: first.value[0], message: first.value[1] };
}
