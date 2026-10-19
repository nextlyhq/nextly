/**
 * What a surface inside a document editor uses to take part in its actions:
 * committing work it holds before the document is stored, and having a write
 * the document depends on counted before it is.
 *
 * Both are safe to call outside a document editor, where there is no action to
 * take part in: the first registers nothing and the second tracks nothing, so
 * a component drawn in both places needs no test for which one it is in.
 *
 * @module components/features/entries/EntryForm/useDocumentActionHooks
 */
import { useCallback, useEffect, useRef } from "react";

import type { DocumentAction } from "./document-actions";
import { reasonFor } from "./DocumentActionBar";
import { useDocumentActionsContext } from "./DocumentActionsContext";
import type {
  BeforeDocumentAction,
  DocumentActionBindings,
  DocumentSaveState,
} from "./useDocumentActionBindings";

/** The document's actions as a surface inside the editor sees them. */
export interface DocumentActions {
  /**
   * Every action this document offers, in the order and placement the
   * editor's own header gives it, each with why it cannot run at this instant
   * when it cannot.
   */
  actions: readonly DocumentAction[];
  /** The action that leads, when one does. */
  primary: DocumentAction | undefined;
  /** Runs one action as its control would, and says what it came to. */
  run: DocumentActionBindings["run"];
  /** Whether the document's work is stored. */
  saveState: DocumentSaveState;
}

/**
 * The document's actions, for a surface drawn inside a document editor —
 * a plugin's document view, which replaces the form body and its header —
 * or null outside one.
 *
 * Derived from what the header draws rather than decided again: the same
 * actions, the same reasons, and running one does what its control does.
 */
export function useDocumentActions(): DocumentActions | null {
  const hosted = useDocumentActionsContext();
  if (hosted === null) return null;
  const offered = hosted.actions.flatMap(action => {
    const binding = hosted.bindings[action.id];
    if (binding === undefined) return [];
    const reason = reasonFor(action, binding);
    return [
      reason === undefined ? action : { ...action, disabledReason: reason },
    ];
  });
  return {
    actions: offered,
    primary: offered.find(action => action.placement === "primary"),
    run: hosted.run,
    saveState: hosted.saveState,
  };
}

/**
 * Runs `handler` before every action that stores the editor's work — Save and
 * Publish, from any control, the shortcut or a plugin — while the calling
 * component is mounted. It may be asynchronous, and the action waits for it;
 * throwing refuses the action with the error's message.
 *
 * The latest `handler` is the one run, so it may close over render state
 * without re-registering on every render.
 */
export function useBeforeDocumentAction(handler: BeforeDocumentAction): void {
  const register = useDocumentActionsContext()?.registerBeforeAction;
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (register === undefined) return undefined;
    return register(action => latest.current(action));
  }, [register]);
}

/**
 * Tracks a write the document depends on but does not contain, under a label
 * an author would recognise ("Site colours"). Storing actions wait for it and
 * are refused, naming the label, while its latest attempt has failed; writing
 * the same label again successfully clears that.
 */
export function useTrackedWrite(): (
  label: string,
  write: Promise<unknown>
) => void {
  const track = useDocumentActionsContext()?.trackWrite;
  return useCallback(
    (label: string, write: Promise<unknown>) => {
      track?.(label, write);
    },
    [track]
  );
}
