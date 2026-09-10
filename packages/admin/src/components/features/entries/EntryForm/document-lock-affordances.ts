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

/**
 * What this editor may do about a colleague's claim, short of taking it.
 *
 * 🔴 A union rather than a label and a flag. "Nothing to offer", "a button" and
 * "we told them" are three states, and carrying them as a nullable label beside
 * a boolean admits a fourth that means nothing — a confirmation with a button
 * still under it, which is what a control that silently re-arms looks like.
 */
export type DocumentAccessRequest =
  /** Not asked yet: the button, and what it says. */
  | { readonly kind: "offer"; readonly label: string }
  /**
   * Asked, and the server has it on record.
   *
   * A whole sentence rather than a tick, because this is the entire answer the
   * person gets: nothing else in the interface changes, by design. A control
   * that silently does nothing is worse than no control.
   */
  | { readonly kind: "sent"; readonly message: string };

/** What the strip above the document says, and what it offers. */
export interface DocumentLockNotice {
  /**
   * Distinguishes "someone has it" from "we cannot vouch for yours" — and
   * `awaited`, which is the only one that is not about a loss at all: the reader
   * holds the document and is simply being told a colleague would like it.
   */
  readonly tone: "held" | "surrendered" | "unchecked" | "awaited";
  /** A whole sentence: the banner is read on its own, without the chrome. */
  readonly message: string;
  /** Present when the editor may claim the document. */
  readonly takeOverLabel: string | null;
  /**
   * Present only where asking means something: a colleague holds the document
   * and this editor is polling for it.
   *
   * Null everywhere the ask could not be carried. On `taken-over` and `lost`
   * the beat has stopped polling and the offer is already "take it back", so a
   * button here would ask a server this editor is no longer talking to — which
   * is exactly the silent control the `sent` state exists to avoid. On
   * `unavailable` the last beat did not reach the server at all, and on
   * `unchecked` nobody has been reported to ask.
   */
  readonly accessRequest: DocumentAccessRequest | null;
}

export interface DocumentLockAffordances {
  /** Fields render uneditable: the document belongs to someone else right now. */
  readonly readOnly: boolean;
  /** Save, publish, delete and every other write are withheld. */
  readonly actionsDisabled: boolean;
  /** What to say above the document, or null when there is nothing to say. */
  readonly notice: DocumentLockNotice | null;
}

/**
 * The two decisions a surface OUTSIDE this form needs from a claim.
 *
 * A custom edit view replaces the form and not the page, so the page keeps
 * rendering the notice and hands over only what the view has to act on.
 *
 * 🔴 Derived with `Pick` rather than written out again. This crosses a package
 * boundary — the admin declares it, the plugin SDK republishes it, a plugin
 * reads it — and a restated pair would go on compiling on both sides while an
 * affordance renamed here quietly stopped reaching the view that gates its
 * writes on it. Renaming one now breaks the consumers instead.
 */
export type DocumentLockGates = Pick<
  DocumentLockAffordances,
  "readOnly" | "actionsDisabled"
>;

const UNLOCKED: DocumentLockAffordances = {
  readOnly: false,
  actionsDisabled: false,
  notice: null,
};

/**
 * The holder, told that a colleague is waiting.
 *
 * 🔴 Withholds NOTHING, and that is the whole design rather than an oversight.
 * It is a courtesy notice and not a consent gate: the reader is not asked a
 * question, is not interrupted, and keeps every action they had. The lease
 * expiring stays the only thing that transfers a document, so a notice that
 * disabled Save would take away the very thing the holder is being given time
 * to finish.
 */
const AWAITED: DocumentLockAffordances = {
  readOnly: false,
  actionsDisabled: false,
  notice: {
    tone: "awaited",
    // Unnamed on purpose. The server records THAT somebody is waiting and not
    // who, so naming one would be a claim about a colleague — and the request
    // is a standing one that any locked-out editor refreshes, so there may be
    // more than one of them.
    message: "Someone is waiting to edit this document.",
    takeOverLabel: null,
    accessRequest: null,
  },
};

/** Everything a colleague's claim withholds, with the sentence that explains it. */
function withheld(
  tone: DocumentLockNotice["tone"],
  message: string,
  takeOverLabel: string,
  accessRequest: DocumentAccessRequest | null = null
): DocumentLockAffordances {
  return {
    readOnly: true,
    actionsDisabled: true,
    notice: { tone, message, takeOverLabel, accessRequest },
  };
}

/** What a locked-out editor may say to the colleague holding the document. */
function accessRequestFor(
  holder: DocumentLockHolder,
  requestSent: boolean
): DocumentAccessRequest {
  return requestSent
    ? {
        kind: "sent",
        // Named when the server named them, because the point of the sentence
        // is that a PERSON was told. Honest when it could not: a claim carries
        // no label when the account had no name to record.
        message:
          holder.ownerLabel === null
            ? "We have let them know you are waiting."
            : `We have let ${holder.ownerLabel} know you are waiting.`,
      }
    : { kind: "offer", label: "Request edit access" };
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
 * 🔴 **Holding the document is no longer always silent.** It gains a notice, and
 * only a notice: `held-by-me` with a colleague waiting keeps every action the
 * holder had. A request moves nothing, cannot be refused, and is not a step in
 * any handover — so anything withheld here would be a consent gate wearing a
 * courtesy notice's words.
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
      return UNLOCKED;

    case "held-by-me":
      return state.someoneWaiting ? AWAITED : UNLOCKED;

    case "held-by-other":
      return withheld(
        "held",
        `${state.holder.ownerLabel} is editing this document. You can read it, or take over.`,
        "Take over",
        accessRequestFor(state.holder, state.requestSent)
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
              accessRequest: null,
            },
          }
        : withheld(
            "held",
            `${lastKnownHolder.ownerLabel} was editing this document, and we could not re-check. You can read it, or take over.`,
            "Take over"
          );
  }
}
