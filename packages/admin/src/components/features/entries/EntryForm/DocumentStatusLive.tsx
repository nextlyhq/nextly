"use client";

/**
 * DocumentStatusLive — the entry editor's spoken status.
 *
 * The header reports two kinds of ambient state about the document being
 * edited: whether the work is stored and how far its translations have got.
 * Both are visible, and both have to be announced too, or the control whose
 * whole purpose is reassuring an author their work is safe does that for
 * sighted users only.
 *
 * Settled status shares ONE polite region rather than one per concern. Two
 * polite regions in the same header interrupt each other, and a reader cannot
 * tell which of two competing announcements belongs to what they just did.
 *
 * A failed save is the one exception, and has a region of its own that is
 * assertive: work the author believes is stored is not, and that must reach
 * them now rather than after whatever is being read.
 *
 * @module components/features/entries/EntryForm/DocumentStatusLive
 */

import { useEffect, useRef, useState } from "react";

import type { DocumentSaveState } from "./useDocumentActionBindings";

export interface DocumentStatusLiveProps {
  /** Whether the document's work is stored. */
  saveState?: DocumentSaveState;
  /**
   * Whether a recovery point newer than the stored document is on offer. Its
   * edits live in the recovery point only, so the work is not stored.
   */
  pendingRecovery?: boolean;
  /** How many configured languages carry a translation. */
  translatedCount?: number;
  /** How many languages are configured. Zero or one means not worth announcing. */
  localeCount?: number;
}

/**
 * The settled description of whether the work is stored, or `null` while it
 * is in a state not worth interrupting the reader for.
 *
 * A full sentence rather than the terse chip beside it ("Saved", "Unsaved
 * changes"). A live-region announcement arrives with no visual context —
 * nothing tells the listener the word belongs to a save indicator — so it has
 * to carry its own subject.
 *
 * Saving says nothing: the useful information is where it comes to rest, not
 * that it is in motion. A failure is announced by the assertive region instead.
 */
function settledStatus(
  saveState: DocumentSaveState | undefined,
  pendingRecovery: boolean
): string | null {
  if (saveState === undefined) return null;
  switch (saveState.kind) {
    case "saving":
    case "failed":
      return null;
    case "unsaved":
      return "You have edits that are not yet stored";
    case "saved":
      if (pendingRecovery) return "You have edits that are not yet stored";
      return saveState.at === null ? null : "Your work is stored";
  }
}

/**
 * Announces settled status once per change in a polite region, and a failed
 * save at once in an assertive one.
 */
export function DocumentStatusLive({
  saveState,
  pendingRecovery = false,
  translatedCount,
  localeCount,
}: DocumentStatusLiveProps) {
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  // What was last announced, so an unchanged status does not re-fire. Held in a
  // ref rather than state because it must not itself cause a render.
  const spoken = useRef<string>("");

  const saveStatus = settledStatus(saveState, pendingRecovery);

  // Only meaningful in a multilingual collection: "1 of 1 languages translated"
  // is noise, and a collection with no locales configured has nothing to say.
  const translationStatus =
    typeof translatedCount === "number" &&
    typeof localeCount === "number" &&
    localeCount > 1
      ? `${translatedCount} of ${localeCount} languages translated`
      : null;

  const next = [saveStatus, translationStatus].filter(Boolean).join(". ");

  useEffect(() => {
    // An empty `next` is a state we chose not to announce (mid-save), not a
    // change to announce as emptiness — leave the last message in place rather
    // than clearing the region, which some readers voice as an interruption.
    if (!next || next === spoken.current) return;
    spoken.current = next;
    setMessage(next);
  }, [next]);

  const failed =
    saveState?.kind === "failed" ? `Not saved. ${saveState.message}` : "";
  useEffect(() => {
    // Cleared once the failure is over, so the same failure happening again
    // changes the region and is announced again rather than heard once.
    setFailure(failed);
  }, [failed]);

  return (
    <>
      <span
        role="status"
        aria-live="polite"
        // Not `aria-atomic`: only the changed sentence needs reading, and
        // reading the whole region again on every save repeats the
        // translation count the reader already has.
        className="sr-only"
        data-testid="document-status-live"
      >
        {message}
      </span>
      <span
        aria-live="assertive"
        className="sr-only"
        data-testid="document-status-failure"
      >
        {failure}
      </span>
    </>
  );
}
