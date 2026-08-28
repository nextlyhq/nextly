/**
 * What became of an attempt to edit a value in place.
 *
 * A commit used to answer with the document it wrote, or `null`. That `null`
 * carried four different outcomes, and two of them are opposites: "the author
 * changed nothing, let go" and "this could not be written, and their words
 * exist only in the editor that is still holding them". Every caller read it as
 * the first, so the ones that meant the second closed the editor over unsaved
 * text, re-pointed the shared editor at another passage, or handed the form a
 * document the author's paragraph never reached.
 *
 * So the outcome is stated rather than encoded in an absence. A host that
 * ignores {@link InlineEditRefused} does not compile, which is the only
 * version of this that stays true as surfaces are added.
 *
 * @module inline-edit-outcome
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";

/** Why a finished edit could not be written. */
export type InlineEditRefusal =
  /**
   * The document's own copy of the value changed while the caret was in it —
   * another surface, an undo, or an op from anywhere else.
   */
  | "moved-on"
  /**
   * The op layer refused the write. A cap the edit would exceed is the case an
   * author can act on; a node that went while they typed is the case they
   * cannot.
   */
  | "rejected";

/** The edit produced a document. */
export interface InlineEditWritten {
  readonly status: "written";
  readonly document: BlockDocument;
}

/** There was nothing to write: no edit was open, or none of it changed. */
export interface InlineEditUnchanged {
  readonly status: "unchanged";
}

/**
 * The author changed the value, it could not be stored, and the surface has
 * been given back.
 *
 * The value stopped being editable while the caret was in it — deleted, locked,
 * or no longer a shape this surface can store. Their typing is gone, and a host
 * that can say so should: nothing else will mention it.
 *
 * Distinct from {@link InlineEditRefused} in the one way that matters to a
 * host: there is nothing left to protect, so this must not stop it closing.
 */
export interface InlineEditDiscarded {
  readonly status: "discarded";
}

/**
 * The edit could not be written and is STILL OPEN, holding the author's words.
 *
 * The surface deliberately kept itself mounted, because letting go is what
 * destroys the text — it lives in the editor and nowhere else, and the page
 * would put the older copy back in its place with nothing said.
 *
 * A host must not close, navigate, or open another value on this. What it
 * should do is leave the caret where it is and tell the author, so the text
 * they can still see is text they can still copy.
 */
export interface InlineEditRefused {
  readonly status: "refused";
  readonly reason: InlineEditRefusal;
}

/**
 * The edit never opened, because the shared editor is holding another one.
 *
 * There is ONE editor behind every surface, and a passage kept open because its
 * words exist nowhere else refuses to give it up. So this is not a failure of
 * the value the author just asked for — it is the previous edit still being
 * protected, and the only thing that resolves it is finishing that one.
 *
 * Reported through the same channel as the outcomes above rather than a second
 * one, because a host that told the author about a refused write in one voice
 * and a refused OPEN in another would be two messages about one editor.
 */
export interface InlineEditUnavailable {
  readonly status: "unavailable";
}

/** What became of an attempt to edit a value in place. */
export type InlineEditOutcome =
  | InlineEditWritten
  | InlineEditUnchanged
  | InlineEditDiscarded
  | InlineEditRefused
  | InlineEditUnavailable;

/** The shared editor was busy protecting an edit that could not be written. */
export const INLINE_EDIT_UNAVAILABLE: InlineEditUnavailable = {
  status: "unavailable",
};

/** Nothing was open, or nothing about the value changed. */
export const INLINE_EDIT_UNCHANGED: InlineEditUnchanged = {
  status: "unchanged",
};

/** The author's typing could not be stored and the surface has been released. */
export const INLINE_EDIT_DISCARDED: InlineEditDiscarded = {
  status: "discarded",
};

/**
 * The document a host should hold after a commit.
 *
 * `held` is what it had before — the right answer for every outcome that did
 * not produce a new one, including a refusal, where the document genuinely has
 * not changed and the edit is still live.
 *
 * @param outcome - what the commit did
 * @param held - the document the host was holding
 * @returns the document to carry forward
 */
export function documentAfter(
  outcome: InlineEditOutcome,
  held: BlockDocument
): BlockDocument {
  return outcome.status === "written" ? outcome.document : held;
}
