"use client";

/**
 * What an editor holding a document does with someone else's change, once the
 * lock has told it of one.
 *
 * - **No unsaved edits:** the current version is loaded at once, and the strip
 *   says whose change the form now shows. Nothing typed can be lost, and the
 *   next edit starts from the current copy instead of heading for a conflict.
 * - **Unsaved edits:** they stay on screen, and the form is held so no read
 *   replaces them before the editor chooses: load the current version (the
 *   edits kept as a recovery point, as a refused save's "Load current" keeps
 *   them, by the same function), or keep editing (a later save is refused, and
 *   the conflict dialog says it again with every choice).
 * - **Taken back after it changed:** the edits are kept and the current version
 *   loads before the form unlocks, and the strip says the change was made
 *   while the editor was away. The recovery offer then restores the edits.
 *
 * The form's own pieces are handed in, so both editors answer one change the
 * same way.
 *
 * @module components/features/entries/EntryForm/useHeldDocumentChange
 */

import type { DocumentLockChange } from "nextly/document-lock";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DocumentLockChangeNotice } from "@admin/hooks/queries/useDocumentLock";
import { formatDateTime } from "@admin/lib/dates/format";
import { changerName } from "@admin/lib/document-version";

import type {
  DocumentLockAffordances,
  DocumentLockNotice,
  HeldChangeChoice,
} from "./document-lock-affordances";

export interface HeldDocumentChangeOptions {
  /** The change the lock told of, not yet answered. */
  change: DocumentLockChangeNotice | null;
  /** The change has been answered: the lock tells it no more. */
  settleChange: () => void;
  /** Whether the form holds edits not yet saved, asked when a change arrives. */
  dirty: () => boolean;
  /** Hold the form on the change, so no read replaces the edits until the editor chooses. */
  hold: (change: DocumentLockChange) => void;
  /**
   * Keep the edits as a recovery point that remembers the version they began
   * from, and load the current version over them: the conflict's "Load current".
   */
  loadCurrent: () => Promise<void>;
  /** Read the document again, which brings the current version to the form. */
  reload: () => Promise<unknown>;
}

export interface HeldDocumentChange {
  /** What the strip says of the change, or null when there is nothing to say. */
  notice: DocumentLockNotice | null;
  /** Whether the current version is loading, which withholds the form. */
  holding: boolean;
  /** The editor's answer to the change. */
  choose: (choice: HeldChangeChoice) => void;
}

/**
 * The opening of a sentence about the change: who made it and when, as a
 * refused save names them (`changerName`); "This document changed" when the
 * change names nobody, as for a row not saved since versions existed.
 */
function changedSentence(change: DocumentLockChange): string {
  const when = change.changedAt
    ? ` at ${formatDateTime(change.changedAt)}`
    : "";
  return change.changedBy
    ? `${changerName(change.changedBy)} changed this document${when}`
    : `This document changed${when}`;
}

const LOAD_CURRENT = {
  choice: "load-current",
  label: "Load current version",
} as const;
const KEEP_EDITING = { choice: "keep-editing", label: "Keep editing" } as const;
const DISMISS = { choice: "dismiss", label: "Dismiss" } as const;

/** A notice of the change, in the lock's strip. */
function changeNotice(
  tone: "changed" | "updated",
  message: string,
  choices: DocumentLockNotice["choices"]
): DocumentLockNotice {
  return { tone, message, takeOverLabel: null, accessRequest: null, choices };
}

export function useHeldDocumentChange({
  change,
  settleChange,
  dirty,
  hold,
  loadCurrent,
  reload,
}: HeldDocumentChangeOptions): HeldDocumentChange {
  const [notice, setNotice] = useState<DocumentLockNotice | null>(null);
  const [holding, setHolding] = useState(false);
  // The form's pieces as they are now, read when a change or a choice
  // arrives, so a new callback from the form does not answer a change again.
  const pieces = useRef({ dirty, hold, loadCurrent, reload });
  pieces.current = { dirty, hold, loadCurrent, reload };

  /**
   * Keep the edits and load the current version, withholding the form until
   * it has. A failure to keep them leaves the conflict dialog saying so, with
   * the edits still on screen and nothing replaced.
   */
  const keepAndLoad = useCallback(async (): Promise<boolean> => {
    setHolding(true);
    try {
      await pieces.current.loadCurrent();
      await pieces.current.reload();
      return true;
    } catch {
      return false;
    } finally {
      setHolding(false);
    }
  }, []);

  useEffect(() => {
    // Nothing told, or nothing a lock that knows no version could tell.
    if (!change) return;
    settleChange();
    const { change: changed, whileAway } = change;
    const said = changedSentence(changed);
    if (!pieces.current.dirty()) {
      // Nothing unsaved: the current version replaces the copy at once.
      setNotice(
        changeNotice(
          "updated",
          `${said}, so it now shows the latest version.`,
          [DISMISS]
        )
      );
      setHolding(true);
      void pieces.current
        .reload()
        .catch(() => undefined)
        .finally(() => setHolding(false));
      return;
    }
    pieces.current.hold(changed);
    if (!whileAway) {
      setNotice(
        changeNotice("changed", `${said}. Your unsaved edits are still here.`, [
          LOAD_CURRENT,
          KEEP_EDITING,
        ])
      );
      return;
    }
    // Taken back: the edits could not be saved while away, and the form
    // unlocks only over the current version.
    setNotice(
      changeNotice(
        "changed",
        `${said} while you were away. It now shows the latest version, and your unsaved edits are kept as a recovery point.`,
        [DISMISS]
      )
    );
    void keepAndLoad();
  }, [change, settleChange, keepAndLoad]);

  const choose = useCallback(
    (choice: HeldChangeChoice) => {
      if (choice !== "load-current") {
        // Keep editing leaves the form held on the change, so no read
        // replaces the edits; a save from them is refused and says it again.
        setNotice(null);
        return;
      }
      void keepAndLoad().then(loaded => {
        if (loaded) setNotice(null);
      });
    },
    [keepAndLoad]
  );

  return { notice, holding, choose };
}

/**
 * The lock's affordances with the change said over them: withheld while the
 * current version loads, and its notice where the lock says nothing that
 * withholds the form. A colleague's claim, which withholds it, keeps its
 * place with the takeover it offers. Carries the editor's answer, so every
 * strip that shows the notice can take it.
 */
export function withHeldChange<T extends DocumentLockAffordances>(
  lock: T,
  held: HeldDocumentChange
): T & { readonly answerChange: (choice: HeldChangeChoice) => void } {
  const answered = { ...lock, answerChange: held.choose };
  if (lock.readOnly) return answered;
  return {
    ...answered,
    ...(held.holding ? { readOnly: true, actionsDisabled: true } : {}),
    ...(held.notice ? { notice: held.notice } : {}),
  };
}
