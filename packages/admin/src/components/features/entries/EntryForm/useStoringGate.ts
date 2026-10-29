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

import { MOVED_MESSAGE } from "./submit-outcome";
import type {
  BeforeDocumentAction,
  DocumentActionOutcome,
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
   * Readies the editor's work for an action that stores it: every open edit
   * committed, every tracked write settled and none failed. Answers with the
   * refusal when it is not ready, or null when it is.
   */
  const readyToStore = async (
    action: string
  ): Promise<DocumentActionOutcome | null> => {
    try {
      for (const before of [...beforeActions.current]) await before(action);
    } catch (error) {
      return {
        ok: false,
        reason: "failed",
        message: apiErrorMessage(error, "An open edit couldn't be committed."),
        beforeWrite: true,
      };
    }
    // Every write registered before the store is awaited, including one
    // started while an earlier one was being waited for. Bounded, so writes
    // that keep starting refuse the store rather than hold it forever.
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
  const storing =
    (action: string, perform: () => Promise<DocumentActionOutcome>) =>
    async (): Promise<DocumentActionOutcome> => {
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
        setReadying(n => n - 1);
      }
    };

  return {
    registerBeforeAction,
    trackWrite,
    storing,
    lastStore,
    inFlight: readying > 0 || writes.current.pending.size > 0,
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
