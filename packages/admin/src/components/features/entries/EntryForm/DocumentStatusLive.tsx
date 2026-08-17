"use client";

/**
 * DocumentStatusLive — the entry editor's single spoken status region.
 *
 * The header reports two kinds of ambient state about the document being
 * edited: whether the work is stored (autosave) and how far its translations
 * have got. Both were visible and NEITHER was announced — `AutoSaveIndicator`
 * cycles through "Saving…", "Saved", "Unsaved changes" and "Not saved" with no
 * live region anywhere in the header, so the control whose entire purpose is
 * reassuring an author their work is safe did that for sighted users only.
 *
 * There is ONE region rather than one per concern. Two live regions in the same
 * header interrupt each other, and a reader cannot tell which of two competing
 * announcements belongs to what they just did. Since both are the same kind of
 * information about the same document, they share a region and take turns.
 *
 * @module components/features/entries/EntryForm/DocumentStatusLive
 */

import { useEffect, useRef, useState } from "react";

export interface DocumentStatusLiveProps {
  /** Whether a save is in flight right now. */
  isSaving?: boolean;
  /** Whether the form holds edits that are not stored. */
  isDirty?: boolean;
  /** When a recovery point was last written, if ever. */
  lastSavedAt?: Date | null;
  /** Whether autosave is even possible for this entry. */
  autosaveEnabled?: boolean;
  /** How many configured languages carry a translation. */
  translatedCount?: number;
  /** How many languages are configured. Zero or one means not worth announcing. */
  localeCount?: number;
}

/**
 * The settled description of where the document stands, or `null` while it is
 * in a state not worth interrupting the reader for.
 *
 * The wording is a full sentence rather than the terse chip beside it
 * ("Saved", "Not saved"). A live-region announcement arrives with no visual
 * context — nothing tells the listener that the word belongs to a save
 * indicator — so it has to carry its own subject. Keeping the two wordings
 * distinct also stops the same text existing twice in the accessibility tree,
 * once on the visible chip and once here.
 *
 * "Saving…" deliberately returns `null`. Autosave debounces, so announcing the
 * transient state speaks over the reader every few seconds WHILE THEY TYPE,
 * which is worse than silence — the useful information is where it came to
 * rest, not that it is in motion.
 */
function settledStatus(
  isSaving: boolean,
  isDirty: boolean,
  lastSavedAt: Date | null
): string | null {
  if (isSaving) return null;
  if (isDirty)
    return lastSavedAt
      ? "You have edits that are not yet stored"
      : "Your work is not yet stored";
  return lastSavedAt ? "Your work is stored" : null;
}

/**
 * Announces document status once per settled change, in a single polite region.
 *
 * `polite` rather than `assertive`: none of this is urgent enough to cut across
 * whatever the reader is doing, and `assertive` on a status that changes as
 * often as this one would make the editor unusable with a screen reader.
 */
export function DocumentStatusLive({
  isSaving = false,
  isDirty = false,
  lastSavedAt = null,
  autosaveEnabled = false,
  translatedCount,
  localeCount,
}: DocumentStatusLiveProps) {
  const [message, setMessage] = useState("");
  // What was last announced, so an unchanged status does not re-fire. Held in a
  // ref rather than state because it must not itself cause a render.
  const spoken = useRef<string>("");

  const saveStatus = autosaveEnabled
    ? settledStatus(isSaving, isDirty, lastSavedAt)
    : null;

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

  return (
    <span
      role="status"
      aria-live="polite"
      // Not `aria-atomic`: only the changed sentence needs reading, and reading
      // the whole region again on every autosave repeats the translation count
      // the reader already has.
      className="sr-only"
      data-testid="document-status-live"
    >
      {message}
    </span>
  );
}
