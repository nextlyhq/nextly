"use client";

/**
 * The form editor's unsaved changes as a hook: records each change against
 * the form as last rendered, counts them for the bar, takes the last one back,
 * and keeps what a save did not store. The rules are `change-history`'s; this
 * holds them across renders.
 *
 * @module admin/context/use-change-history
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  beginSaving,
  emptyHistory,
  markSaved,
  rebaseEntries,
  recordChange,
  undoChange,
  type ChangeHistory,
} from "./change-history";

export interface ChangeHistoryHandle<Doc> {
  /** How many unsaved changes there are. */
  changeCount: number;
  /**
   * How many times Undo has restored the form. An editor that keeps its own
   * copy of a value (a mode it opened in) is keyed on it, so it reads the
   * restored value afresh rather than showing what was taken back.
   */
  restored: number;
  /** The form as last rendered, which the next change records. */
  current: () => Doc;
  /** Count a change about to be made; `key` names what it edits. */
  record: (key: string | null) => void;
  /** Take the last change back, handing its form to `restore`. */
  undo: () => void;
  /** A save begins: what it stores is what is unsaved now. */
  beginSave: () => void;
  /** The save that began has stored the form. */
  markSaved: () => void;
  /** Pass every kept record through `rebase` (see `rebaseEntries`). */
  rebase: (rebase: (record: Doc) => Doc) => void;
}

/**
 * @param document - the form as rendered, one object per render, so two
 *   writes in one event record it once
 * @param restore - puts a form back, for Undo; stable across renders
 */
export function useChangeHistory<Doc>(
  document: Doc,
  restore: (document: Doc) => void
): ChangeHistoryHandle<Doc> {
  // A ref, because each change records the form as the event found it;
  // `changeCount` is its length, for rendering.
  const history = useRef<ChangeHistory<Doc>>(emptyHistory());
  const [changeCount, setChangeCount] = useState(0);
  const [restored, setRestored] = useState(0);
  // How many changes the save under way is storing (`beginSaving`).
  const saveMark = useRef<number | undefined>(undefined);
  const documentRef = useRef(document);
  useLayoutEffect(() => {
    documentRef.current = document;
  }, [document]);

  const settle = useCallback((next: ChangeHistory<Doc>) => {
    history.current = next;
    setChangeCount(next.entries.length);
  }, []);

  const current = useCallback(() => documentRef.current, []);

  const record = useCallback(
    (key: string | null) =>
      settle(
        recordChange(history.current, documentRef.current, key, Date.now())
      ),
    [settle]
  );

  const undo = useCallback(() => {
    const undone = undoChange(history.current);
    if (undone === undefined) return;
    settle(undone.history);
    restore(undone.restore);
    setRestored(count => count + 1);
  }, [settle, restore]);

  const beginSave = useCallback(() => {
    const begun = beginSaving(history.current);
    history.current = begun.history;
    saveMark.current = begun.mark;
  }, []);

  const saved = useCallback(() => {
    settle(markSaved(history.current, saveMark.current));
    saveMark.current = undefined;
  }, [settle]);

  const rebase = useCallback((each: (record: Doc) => Doc) => {
    history.current = rebaseEntries(history.current, each);
  }, []);

  return {
    changeCount,
    restored,
    current,
    record,
    undo,
    beginSave,
    markSaved: saved,
    rebase,
  };
}
