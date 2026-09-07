/**
 * What a lock state means for the editor around it.
 *
 * One derivation, two consumers. The collection editor and the single editor
 * both have to decide the same things from the same state, and a rule spelled
 * twice is one edit away from a document that renders read-only in one of them
 * while still offering Save in the other.
 *
 * @module components/features/entries/EntryForm/document-lock-affordances
 */

import type { DocumentLockHolder } from "nextly/document-lock";

import type { DocumentLockState } from "@admin/hooks/queries/useDocumentLock";

/** What the strip above the document says, and what it offers. */
export interface DocumentLockNotice {
  /** Distinguishes "someone has it" from "we cannot vouch for yours". */
  readonly tone: "held" | "surrendered" | "unchecked";
  /** A whole sentence: the banner is read on its own, without the chrome. */
  readonly message: string;
  /** Present when the editor may claim the document. */
  readonly takeOverLabel: string | null;
}

export interface DocumentLockAffordances {
  /** Fields render uneditable: the document belongs to someone else right now. */
  readonly readOnly: boolean;
  /** Save, publish, delete and every other write are withheld. */
  readonly actionsDisabled: boolean;
  /** What to say above the document, or null when there is nothing to say. */
  readonly notice: DocumentLockNotice | null;
}

const UNLOCKED: DocumentLockAffordances = {
  readOnly: false,
  actionsDisabled: false,
  notice: null,
};

/** Everything a colleague's claim withholds, with the sentence that explains it. */
function withheld(
  tone: DocumentLockNotice["tone"],
  message: string,
  takeOverLabel: string
): DocumentLockAffordances {
  return {
    readOnly: true,
    actionsDisabled: true,
    notice: { tone, message, takeOverLabel },
  };
}

/**
 * Turn a claim's state into the editor's behaviour.
 *
 * `lastKnownHolder` is the colleague this editor was last told about, which
 * outlives a failed refresh. Null when nobody has ever been reported.
 *
 * Decisions here that are not the obvious one:
 *
 * 🔴 **`acquiring` does not block editing.** Every document open would otherwise
 * wait on a round trip before its first keystroke, to guard against a case that
 * is rare — and the keystrokes are not lost if the claim comes back refused,
 * because nothing here clears the form. A moment of optimism costs a few
 * characters typed into a document that turns out to be someone else's; gating
 * on the network costs every author on every open.
 *
 * 🔴 **A failure to REFRESH a known claim is not news that the document is
 * free.** `unavailable` is not only the first check: every beat re-asks, and any
 * transient rejection lands here. Treating that as "unlocked" hands the document
 * back to a second editor while the last confirmed fact is that a colleague
 * holds an unexpired lease. So it unlocks only when nobody was ever reported.
 *
 * 🔴 **A displaced editor goes read-only rather than losing what they typed.**
 * Their unsaved work stays on screen and stays theirs; what stops is writing,
 * because a colleague holds the row now. Clearing the form would be the one
 * unrecoverable thing this could do.
 *
 * 🔴 **Autosave is NOT stopped, and this is worth stating because the opposite
 * looks obviously right.** `useDocumentAutosave` does not write the document: it
 * upserts a recovery row keyed by document AND author, marked `isAutosave`,
 * which the live-row predicate excludes. One editor's recovery point therefore
 * cannot reach the holder's document, or their recovery row.
 *
 * Stopping it would remove the displaced editor's safety net at the exact moment
 * the banner promises their unsaved changes are still theirs. The engine also
 * depends on it running: `document-lock-repository` says a takeover moves the
 * ousted author's work nowhere precisely BECAUSE that per-author row is written
 * on an interval of its own, including when the ousted client is asleep, offline
 * or gone.
 */
export function documentLockAffordances(
  state: DocumentLockState,
  lastKnownHolder: DocumentLockHolder | null = null
): DocumentLockAffordances {
  switch (state.status) {
    case "idle":
    case "acquiring":
    case "held-by-me":
      return UNLOCKED;

    case "held-by-other":
      return withheld(
        "held",
        `${state.holder.ownerLabel} is editing this document. You can read it, or take over.`,
        "Take over"
      );

    case "taken-over":
      return withheld(
        "surrendered",
        // Named when the server knew who, and honest when it did not: a claim
        // that simply lapsed has nobody to name, and inventing one would be a
        // claim about a colleague.
        state.holder
          ? `${state.holder.ownerLabel} took over this document. Your unsaved changes are still here, but cannot be saved until you take it back.`
          : "Your claim on this document ended. Your unsaved changes are still here, but cannot be saved until you take it back.",
        "Take it back"
      );

    case "lost":
      return withheld(
        "surrendered",
        // Deliberately not "someone took over". Nobody said that. What is true
        // is that this editor can no longer vouch for holding it.
        "This document could not be confirmed as yours for long enough that a colleague may now be editing it. Your unsaved changes are still here.",
        "Take it back"
      );

    case "unavailable":
      return lastKnownHolder === null
        ? {
            readOnly: false,
            actionsDisabled: false,
            notice: {
              tone: "unchecked",
              message:
                "We could not check whether anyone else is editing this document. You can keep working, but a colleague may be in it too.",
              takeOverLabel: null,
            },
          }
        : withheld(
            "held",
            `${lastKnownHolder.ownerLabel} was editing this document, and we could not re-check. You can read it, or take over.`,
            "Take over"
          );
  }
}
