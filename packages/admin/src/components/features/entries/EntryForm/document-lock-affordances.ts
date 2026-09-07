/**
 * What a lock state means for the editor around it.
 *
 * One derivation, two consumers. The collection editor and the single editor
 * both have to decide the same four things from the same state, and a rule
 * spelled twice is one edit away from a document that renders read-only in one
 * of them while still autosaving in the other.
 *
 * @module components/features/entries/EntryForm/document-lock-affordances
 */

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
  /** Save, publish, delete and the rest are withheld. */
  readonly actionsDisabled: boolean;
  /** Whether a recovery point may be written. */
  readonly autosaveAllowed: boolean;
  /** What to say above the document, or null when there is nothing to say. */
  readonly notice: DocumentLockNotice | null;
}

const UNLOCKED: DocumentLockAffordances = {
  readOnly: false,
  actionsDisabled: false,
  autosaveAllowed: true,
  notice: null,
};

/**
 * Turn a claim's state into the editor's behaviour.
 *
 * Four decisions, each with a reason it is not the obvious one:
 *
 * 🔴 **`acquiring` does not block editing.** Every document open would otherwise
 * wait on a round trip before its first keystroke, to guard against a case that
 * is rare — and the keystrokes are not lost if the claim comes back refused,
 * because nothing here clears the form. A moment of optimism costs a few
 * characters typed into a document that turns out to be someone else's; gating
 * on the network costs every author on every open.
 *
 * 🔴 **`unavailable` does not block editing either**, and this is the one most
 * easily got wrong. The lock is advisory: it exists to tell two people about
 * each other, not to be a permission. A guard that stops work when it cannot
 * reach the server has turned an advisory nicety into an outage, and it fails in
 * the direction that loses the author's afternoon.
 *
 * 🔴 **A displaced editor goes read-only rather than losing what they typed.**
 * Their unsaved work stays on screen and stays theirs; what stops is writing,
 * because a colleague holds the row now. Clearing the form would be the one
 * unrecoverable thing this could do.
 *
 * 🔴 **Autosave stops wherever writing stops.** The recovery point is a write to
 * the same document, so leaving it running while a colleague edits is exactly
 * the overwrite this feature exists to prevent — quieter, and therefore worse.
 */
export function documentLockAffordances(
  state: DocumentLockState
): DocumentLockAffordances {
  switch (state.status) {
    case "idle":
    case "acquiring":
    case "held-by-me":
      return UNLOCKED;

    case "held-by-other":
      return {
        readOnly: true,
        actionsDisabled: true,
        autosaveAllowed: false,
        notice: {
          tone: "held",
          message: `${state.holder.ownerLabel} is editing this document. You can read it, or take over.`,
          takeOverLabel: "Take over",
        },
      };

    case "taken-over":
      return {
        readOnly: true,
        actionsDisabled: true,
        autosaveAllowed: false,
        notice: {
          tone: "surrendered",
          // Named when the server knew who, and honest when it did not: a claim
          // that simply lapsed has nobody to name, and inventing one would be a
          // claim about a colleague.
          message: state.holder
            ? `${state.holder.ownerLabel} took over this document. Your unsaved changes are still here, but cannot be saved until you take it back.`
            : "Your claim on this document ended. Your unsaved changes are still here, but cannot be saved until you take it back.",
          takeOverLabel: "Take it back",
        },
      };

    case "lost":
      return {
        readOnly: true,
        actionsDisabled: true,
        autosaveAllowed: false,
        notice: {
          tone: "surrendered",
          // Deliberately not "someone took over". Nobody said that. What is true
          // is that this editor can no longer vouch for holding it.
          message:
            "This document could not be confirmed as yours for long enough that a colleague may now be editing it. Your unsaved changes are still here.",
          takeOverLabel: "Take it back",
        },
      };

    case "unavailable":
      return {
        readOnly: false,
        actionsDisabled: false,
        autosaveAllowed: true,
        notice: {
          tone: "unchecked",
          message:
            "We could not check whether anyone else is editing this document. You can keep working, but a colleague may be in it too.",
          takeOverLabel: null,
        },
      };
  }
}
