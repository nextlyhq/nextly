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

import { apiErrorMessage } from "@admin/lib/api/parseApiError";

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

export function useStoringGate(): StoringGate {
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
      };
    }
    await Promise.allSettled([...writes.current.pending.values()]);
    const failure = firstFailure(writes.current.failed);
    return failure === null
      ? null
      : {
          ok: false,
          reason: "refused",
          message: `${failure.label} wasn't saved, so this page wasn't either: ${failure.message}`,
        };
  };

  /*
   * What the last storing action came to, for the save state. Busy and
   * cancelled are not answers about the work, so they leave it as it was.
   */
  const [lastStore, setLastStore] = useState<LastStore>({ kind: "none" });
  const [readying, setReadying] = useState(0);
  const record = (action: string, outcome: DocumentActionOutcome) => {
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
      setReadying(n => n + 1);
      try {
        const outcome = (await readyToStore(action)) ?? (await perform());
        record(action, outcome);
        return outcome;
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
