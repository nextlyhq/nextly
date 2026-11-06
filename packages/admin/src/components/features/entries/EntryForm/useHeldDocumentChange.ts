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
import type { DocumentLatest } from "@admin/hooks/queries/useStoredReferences";
import { formatDateTime } from "@admin/lib/dates/format";
import { changerName } from "@admin/lib/document-version";

import type {
  DocumentLockAffordances,
  DocumentLockNotice,
  HeldChangeChoice,
} from "./document-lock-affordances";
import type { DocumentLockSurface } from "./useDocumentLockSurface";

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
  /**
   * Whether the document keeps recovery points, asked when a change arrives:
   * where it keeps none, loading the current version discards the edits, so
   * it is never done without the editor choosing it.
   */
  keepsEdits: () => boolean;
  /** Let go of a hold the form no longer needs: nothing unsaved is left to keep. */
  release: () => void;
  /**
   * The editor keeps editing after all: a current version asked for and not
   * yet read no longer replaces the edits when it arrives.
   */
  stopLoading: () => void;
}

export interface HeldDocumentChange {
  /** What the strip says of the change, or null when there is nothing to say. */
  notice: DocumentLockNotice | null;
  /** Whether the current version is loading, which withholds the form. */
  holding: boolean;
  /** The editor's answer to the change. */
  choose: (choice: HeldChangeChoice) => void;
  /**
   * A change over unsaved edits waits for the editor's answer: until then the
   * editor stays in this language, whose edits the answer is about.
   */
  awaitingAnswer: boolean;
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
const TRY_AGAIN = { choice: "try-again", label: "Try again" } as const;

/** A notice of the change, in the lock's strip. */
function changeNotice(
  tone: "changed" | "updated",
  message: string,
  choices: DocumentLockNotice["choices"]
): DocumentLockNotice {
  return { tone, message, takeOverLabel: null, accessRequest: null, choices };
}

/**
 * A change over unsaved edits, offered to load or keep editing; where the
 * document keeps no recovery points, saying that loading discards them.
 */
function overEditsNotice(
  said: string,
  whileAway: boolean,
  keepsEdits: boolean
): DocumentLockNotice {
  const away = whileAway ? " while you were away" : "";
  const discards = keepsEdits
    ? ""
    : " Loading the current version discards them.";
  return changeNotice(
    "changed",
    `${said}${away}. Your unsaved edits are still here.${discards}`,
    [LOAD_CURRENT, KEEP_EDITING]
  );
}

export function useHeldDocumentChange({
  change,
  settleChange,
  dirty,
  hold,
  loadCurrent,
  reload,
  keepsEdits,
  release,
  stopLoading,
}: HeldDocumentChangeOptions): HeldDocumentChange {
  const [notice, setNotice] = useState<DocumentLockNotice | null>(null);
  const [holding, setHolding] = useState(false);
  // The form's pieces as they are now, read when a change or a choice
  // arrives, so a new callback from the form does not answer a change again.
  const pieces = useRef({
    dirty,
    hold,
    loadCurrent,
    reload,
    keepsEdits,
    release,
    stopLoading,
  });
  pieces.current = {
    dirty,
    hold,
    loadCurrent,
    reload,
    keepsEdits,
    release,
    stopLoading,
  };
  // The change being answered: what the strip says of it, and its version.
  const answering = useRef<{ said: string; change: DocumentLockChange } | null>(
    null
  );

  // 🔴 Withheld before anything is kept. A field that holds its own work,
  // the page builder's store, hands it to the form as it unmounts, so the
  // recovery point is taken once the form has been withheld and rendered
  // without it, not in the turn that asked.
  const withheldNow = useRef(false);
  const whenWithheld = useRef<(() => void) | null>(null);
  useEffect(() => {
    withheldNow.current = holding;
    if (holding) {
      whenWithheld.current?.();
      whenWithheld.current = null;
    }
  }, [holding]);
  const withhold = useCallback(
    (): Promise<void> =>
      withheldNow.current
        ? Promise.resolve()
        : new Promise<void>(resolve => {
            whenWithheld.current = resolve;
            setHolding(true);
          }),
    []
  );

  /**
   * Read the current version into the form. 🔴 Its version is taken from that
   * read as the form applies it, never from the change told: the read answers
   * a render before its values reach the form, and a copy marked current over
   * the older values would let a save in that moment write them, accepted, over
   * the change. Left on its version, such a save is refused instead.
   */
  const reloadCurrent = useCallback(async (): Promise<void> => {
    await pieces.current.reload();
  }, []);

  /**
   * Keep the edits and load the current version, withholding the form until
   * it has. A failure leaves the edits on screen and nothing replaced, and
   * answers false for the strip to say so.
   */
  const keepAndLoad = useCallback(async (): Promise<boolean> => {
    await withhold();
    try {
      await pieces.current.loadCurrent();
      await reloadCurrent();
      return true;
    } catch {
      return false;
    } finally {
      setHolding(false);
    }
  }, [withhold, reloadCurrent]);

  /** Nothing unsaved: the current version replaces the copy, said once it has. */
  const refreshClean = useCallback(
    async (said: string, changed: DocumentLockChange): Promise<void> => {
      // 🔴 Let go of any hold first, this refresh's own from a failed try
      // included: a held form turns the read away, while the told version
      // would still be taken as the copy's, and a save would then send the
      // older values as current, over the change, with nothing refused.
      pieces.current.release();
      setHolding(true);
      try {
        await reloadCurrent();
        setNotice(
          changeNotice(
            "updated",
            `${said}, so it now shows the latest version.`,
            [DISMISS]
          )
        );
      } catch {
        // Still the older copy: held, so a save from it is refused rather
        // than written over the change, and offered again.
        pieces.current.hold(changed);
        setNotice(
          changeNotice(
            "changed",
            `${said}. This copy could not be updated to the latest version.`,
            [TRY_AGAIN]
          )
        );
      } finally {
        setHolding(false);
      }
    },
    [reloadCurrent]
  );

  /** What the strip says when the edits could not be kept, and the copy stays. */
  const notKept = useCallback((said: string) => {
    setNotice(
      changeNotice(
        "changed",
        `${said}. Your unsaved edits are still here: they could not be kept as a recovery point, so the latest version was not loaded.`,
        [LOAD_CURRENT, KEEP_EDITING]
      )
    );
  }, []);

  useEffect(() => {
    // Nothing told, or nothing a lock that knows no version could tell.
    if (!change) return;
    settleChange();
    const { change: changed, whileAway } = change;
    const said = changedSentence(changed);
    answering.current = { said, change: changed };
    if (!pieces.current.dirty()) {
      void refreshClean(said, changed);
      return;
    }
    pieces.current.hold(changed);
    // 🔴 Where nothing can keep the edits, loading the current version
    // discards them, so it waits for the editor, taken back or not.
    if (!whileAway || !pieces.current.keepsEdits()) {
      setNotice(overEditsNotice(said, whileAway, pieces.current.keepsEdits()));
      return;
    }
    // Taken back: the edits could not be saved while away, and the form
    // unlocks only over the current version. Said once it has.
    setNotice(null);
    void keepAndLoad().then(loaded => {
      if (!loaded) {
        notKept(said);
        return;
      }
      setNotice(
        changeNotice(
          "changed",
          `${said} while you were away. It now shows the latest version, and your unsaved edits are kept as a recovery point.`,
          [DISMISS]
        )
      );
    });
  }, [change, settleChange, keepAndLoad, refreshClean, notKept]);

  const choose = useCallback(
    (choice: HeldChangeChoice) => {
      const current = answering.current;
      if (choice === "try-again" && current) {
        // 🔴 The form unlocks under the failed try's strip, so what is typed
        // there since is unsaved work a reload would replace: the editor
        // chooses, as over any edits.
        if (pieces.current.dirty()) {
          pieces.current.hold(current.change);
          setNotice(
            overEditsNotice(current.said, false, pieces.current.keepsEdits())
          );
          return;
        }
        void refreshClean(current.said, current.change);
        return;
      }
      if (choice === "keep-editing") {
        // Keep editing leaves the form held on the change, so no read
        // replaces the edits; a save from them is refused and says it again.
        // 🔴 A load chosen before, whose read failed, may still wait for the
        // current version: once kept editing, it no longer replaces them.
        pieces.current.stopLoading();
        setNotice(null);
        return;
      }
      if (choice !== "load-current") {
        setNotice(null);
        return;
      }
      void keepAndLoad().then(loaded => {
        if (loaded) setNotice(null);
        else if (current) notKept(current.said);
      });
    },
    [keepAndLoad, refreshClean, notKept]
  );

  // Waiting on the editor: a change told over edits, offered to load.
  const awaitingAnswer =
    notice?.choices?.some(option => option.choice === "load-current") ?? false;

  return { notice, holding, choose, awaitingAnswer };
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
): T & {
  readonly answerChange: (choice: HeldChangeChoice) => void;
  readonly changeAwaitingAnswer: boolean;
} {
  const answered = {
    ...lock,
    answerChange: held.choose,
    changeAwaitingAnswer: held.awaitingAnswer,
  };
  if (lock.readOnly) return answered;
  return {
    ...answered,
    ...(held.holding ? { readOnly: true, actionsDisabled: true } : {}),
    ...(held.notice ? { notice: held.notice } : {}),
  };
}

/**
 * An editor's lock with someone else's change said over it: one wiring for
 * both editors. `lock` is what the editor's claim allows so far; the surface
 * tells the change, and the form holds its edits and loads the current
 * version.
 */
/**
 * What the editor knows only once it has rendered further down than its lock:
 * set there, each render, and read when a change or a choice arrives.
 */
export interface HeldChangeEditorNow {
  /** Whether anything unsaved is on screen, a field's own store included. */
  hasUnsavedWork: boolean;
  /** Whether the document keeps recovery points. */
  keepsEdits: boolean;
  /**
   * Load the current version, keeping the edits as a recovery point where
   * the document keeps them: one way, for a refused save's dialog and for
   * someone else's change alike.
   */
  keepEditsAndLoad: () => Promise<void>;
  /**
   * Stop waiting for a current version a load asked for and has not read:
   * the editor keeps editing, so it no longer replaces the edits.
   */
  stopLoadingCurrent: () => void;
}

export function useLockWithHeldChange<T extends DocumentLockAffordances>(
  lock: T,
  editor: {
    surface: Pick<DocumentLockSurface, "change" | "settleChange">;
    hold: (change: DocumentLockChange) => void;
    /** The reads that feed the form; absent, nothing is read again. */
    latest: DocumentLatest | undefined;
    /** Let go of a hold nothing unsaved needs any more. */
    release: () => void;
  }
): ReturnType<typeof withHeldChange<T>> & {
  /** Set by the editor where it knows each, and read by the held change. */
  readonly now: HeldChangeEditorNow;
} {
  // One object for the editor's life, so what it sets below its lock is what
  // the held change reads, whichever render set it.
  const now = useRef<HeldChangeEditorNow>({
    hasUnsavedWork: false,
    keepsEdits: false,
    keepEditsAndLoad: async () => {},
    stopLoadingCurrent: () => {},
  });
  const held = useHeldDocumentChange({
    change: editor.surface.change,
    settleChange: editor.surface.settleChange,
    dirty: () => now.current.hasUnsavedWork,
    hold: editor.hold,
    loadCurrent: () => now.current.keepEditsAndLoad(),
    reload: () => editor.latest?.reload() ?? Promise.resolve(),
    keepsEdits: () => now.current.keepsEdits,
    release: editor.release,
    stopLoading: () => now.current.stopLoadingCurrent(),
  });
  return { ...withHeldChange(lock, held), now: now.current };
}
