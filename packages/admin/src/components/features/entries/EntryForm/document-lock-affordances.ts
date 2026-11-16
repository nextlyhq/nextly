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

/**
 * What an editor told of someone else's change may answer: load the current
 * version (the edits kept as a recovery point), keep editing, or put away a
 * sentence that asks nothing.
 */
export type HeldChangeChoice =
  | "load-current"
  | "keep-editing"
  | "dismiss"
  | "try-again";

/** One answer to someone else's change, and what its button says. */
export interface HeldChangeOption {
  readonly choice: HeldChangeChoice;
  readonly label: string;
}

/** What the strip above the document says, and what it offers. */
export interface DocumentLockNotice {
  /**
   * Distinguishes "someone has it" from "we cannot vouch for yours" — and
   * `awaited`, which is the only one that is not about a loss at all: the reader
   * holds the document and is simply being told a colleague would like it.
   */
  readonly tone:
    | "held"
    | "surrendered"
    | "unchecked"
    | "awaited"
    | "reader"
    | "loading"
    | "unloaded"
    /** Someone else changed the document this editor holds, over their edits. */
    | "changed"
    /** Someone else changed it, and the form, with no edits, now shows it. */
    | "updated";
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
  /**
   * Present when the latest version of the document could not be loaded: what
   * asking for it again says.
   */
  readonly retryLabel?: string;
  /** Present when someone else's change asks the editor what to do. */
  readonly choices?: readonly HeldChangeOption[];
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

/**
 * What a lock message calls the holder: the label the server gave their claim,
 * or "Someone" when it gave none.
 *
 * 🔴 The one place a holder is named, so no message can print "null is
 * editing this document". The server labels every claim it takes now, but a
 * lease taken before it did, or a label that is only spaces, still reaches
 * here, and each sentence spelling its own fallback is how one of them forgot.
 */
function holderName(holder: DocumentLockHolder): string {
  return holderLabel(holder) ?? "Someone";
}

/** The label the server gave the holder's claim, or null when it gave none. */
function holderLabel(holder: DocumentLockHolder): string | null {
  return holder.ownerLabel?.trim() || null;
}

/**
 * A user who may read the document but not change it.
 *
 * Read-only for the same reason a colleague's claim makes it so, and said in
 * the same strip, but nothing about a claim: the reader makes none, so nobody
 * is named and nothing can be taken over or asked for. The actions stay
 * enabled because the ones still offered (publishing, unpublishing, deleting)
 * each follow their own permission; those that change the content are not
 * offered at all. It names no role or permission, so it reads the same for
 * one role or several.
 */
const READ_ONLY_FOR_READER: DocumentLockAffordances = {
  readOnly: true,
  actionsDisabled: false,
  notice: {
    tone: "reader",
    message:
      "Your access lets you view this, but not change it. If you need to change it, ask an admin.",
    takeOverLabel: null,
    accessRequest: null,
  },
};

/**
 * A document whose collection or Single was removed from code: read-only for
 * everyone, with no claim made, as for a reader. The strip says nothing: the
 * editor's document banner carries the notice that names the entity and its
 * next step, and a second sentence here would say it twice.
 */
export const READ_ONLY_REMOVED_FROM_CODE: DocumentLockAffordances = {
  readOnly: true,
  actionsDisabled: false,
  notice: null,
};

/**
 * A reader's affordances, given who holds the document. A reader who may
 * publish writes its status, and that write waits while a colleague holds the
 * document, or until the lock has been read: a publish then would put a change
 * still being made live.
 */
export function readerAffordances(
  holder: DocumentLockHolder | null | undefined
): DocumentLockAffordances {
  if (holder === null) return READ_ONLY_FOR_READER;
  return {
    ...READ_ONLY_FOR_READER,
    actionsDisabled: true,
    ...(holder === undefined
      ? {}
      : {
          notice: {
            tone: "reader",
            // Named when the server named them, and promising nothing: a
            // reader may hold no publish to make once they are done.
            message: `${holderName(holder)} is editing this document right now.`,
            takeOverLabel: null,
            accessRequest: null,
          },
        }),
  };
}

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
          holderLabel(holder) === null
            ? "We have let them know you are waiting."
            : `We have let ${holderLabel(holder)} know you are waiting.`,
      }
    : { kind: "offer", label: "Request edit access" };
}

/**
 * Whether the document on screen is the latest one the editor could read.
 *
 * `loading` after a gain: an editor who gains a document they were kept out of
 * read it while a colleague held it, and the reads made since have not reached
 * it yet. `failed` when a read of the document on screen failed, after a gain
 * or at any other time, such as the read that follows a save.
 */
export type LatestDocumentLoad = "current" | "loading" | "failed";

/**
 * A gained document whose latest version is on its way. Withheld like a
 * colleague's claim, because a save from here would write the copy read while
 * they held it, which may be older than what they saved.
 */
const LOADING_LATEST: DocumentLockAffordances = {
  readOnly: true,
  actionsDisabled: true,
  notice: {
    tone: "loading",
    message: "Loading the latest version of this document before you edit it.",
    takeOverLabel: null,
    accessRequest: null,
  },
};

/**
 * A document whose latest version could not be loaded: it stays read-only, and
 * says so, rather than letting the editor save over a copy that may be out of
 * date. Its unsaved changes stay in the form.
 */
const LATEST_UNLOADED: DocumentLockAffordances = {
  readOnly: true,
  actionsDisabled: true,
  notice: {
    tone: "unloaded",
    message:
      "We couldn't load the latest version of this document, so you can't edit it yet.",
    takeOverLabel: null,
    accessRequest: null,
    retryLabel: "Try again",
  },
};

/**
 * The notice for someone who may only read the document: nothing more to hold
 * back, but what they read may be out of date.
 */
export const READER_LATEST_UNLOADED: DocumentLockNotice = {
  tone: "unloaded",
  message:
    "We couldn't load the latest version of this document, so what you see may be out of date.",
  takeOverLabel: null,
  accessRequest: null,
  retryLabel: "Try again",
};

/**
 * Turn a claim's state into the editor's behaviour.
 *
 * `lastKnownHolder` is the colleague this editor was last told about, which
 * outlives a failed refresh. Null when nobody has ever been reported.
 * `latest` says whether the document on screen is the latest one; it matters
 * only where the editor could otherwise type.
 *
 * `me` is the signed-in user's id, null while it is not known. A claim is
 * held per person, so a holder with this id is this person in another tab,
 * and is told as such rather than as a colleague.
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
 *
 * 🔴 **One person's other tab is not a colleague.** A claim is held per
 * person, so opening the document in a second tab moves the claim there, and
 * this tab reads as taken over by its own user. Saying "Ada took over" to Ada
 * describes something that did not happen; she is told she opened it in
 * another tab, and offered to continue here, which claims it back with her
 * unsaved edits still on screen.
 */
export function documentLockAffordances(
  state: DocumentLockState,
  lastKnownHolder: DocumentLockHolder | null = null,
  latest: LatestDocumentLoad = "current",
  me: string | null = null
): DocumentLockAffordances {
  const claimed = claimAffordances(state, lastKnownHolder, me);
  // 🔴 Over every notice that lets the editor type, the courtesy and unchecked
  // ones included: those withhold nothing, and a copy that may be out of date
  // withholds everything. A notice that already withholds the form keeps its
  // place, with the takeover or take-back it offers.
  if (claimed.readOnly || latest === "current") return claimed;
  return latest === "loading" ? LOADING_LATEST : LATEST_UNLOADED;
}

/** What the claim alone allows, before the document's freshness is asked. */
function claimAffordances(
  state: DocumentLockState,
  lastKnownHolder: DocumentLockHolder | null,
  me: string | null
): DocumentLockAffordances {
  const isMine = (holder: DocumentLockHolder) =>
    me !== null && holder.ownerId === me;
  switch (state.status) {
    case "idle":
    case "acquiring":
      return UNLOCKED;

    case "held-by-me":
      return state.someoneWaiting ? AWAITED : UNLOCKED;

    case "held-by-other":
      // The server hands a person's own claim back to them rather than refusing
      // it, so this is not expected; were it to happen, asking oneself for
      // access would be the silent control `sent` exists to avoid.
      if (isMine(state.holder)) {
        return withheld(
          "held",
          "You have this document open in another tab. You can read it here, or continue editing here.",
          "Continue editing here"
        );
      }
      return withheld(
        "held",
        `${holderName(state.holder)} is editing this document. You can read it, or take over.`,
        "Take over",
        accessRequestFor(state.holder, state.requestSent)
      );

    case "taken-over":
      if (state.holder && isMine(state.holder)) {
        return withheld(
          "surrendered",
          "You opened this document in another tab. Your unsaved changes are still here, but cannot be saved until you continue editing here.",
          "Continue editing here"
        );
      }
      return withheld(
        "surrendered",
        // Named when the server knew who, and honest when it did not: a claim
        // that simply lapsed has nobody to name, and inventing one would be a
        // claim about a colleague.
        state.holder
          ? `${holderName(state.holder)} took over this document. Your unsaved changes are still here, but cannot be saved until you take it back.`
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
            `${holderName(lastKnownHolder)} was editing this document, and we could not re-check. You can read it, or take over.`,
            "Take over"
          );
  }
}

/**
 * What holds the document for what a plugin draws on its editor, a side panel
 * section, a replaced action or a tab, as both editors tell it: `readOnly`
 * where the fields and the language panel's copies into the form are held
 * (`contentHeld`), and `actionsDisabled` where the built-in Delete is: a
 * colleague's claim or a past version on screen (`writesHeld`), a refused
 * publish's recovery, or a document removed from code, where the server
 * refuses every write. A reader's page alone is not among them: a plugin's
 * own write follows its own permission, which its route judges.
 */
export function pluginDocumentLock(holds: {
  contentHeld: boolean;
  writesHeld: boolean;
  recovering: boolean;
  removedFromCode: boolean;
}): DocumentLockGates {
  return {
    readOnly: holds.contentHeld,
    actionsDisabled:
      holds.writesHeld || holds.recovering || holds.removedFromCode,
  };
}
