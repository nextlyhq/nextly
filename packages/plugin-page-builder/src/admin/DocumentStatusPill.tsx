"use client";

/**
 * Whether the page being edited is live, shown inside the editor.
 *
 * The editor takes the whole window and asks the admin to hide its chrome, so
 * the status the entry and Single editors show beside the form is not on screen
 * while an author is in here. Without this the only thing the top bar says is
 * "Save", which does not answer the question an author actually has: is what I
 * am looking at what a visitor sees?
 *
 * ## The state is derived here, not read
 *
 * `useDocumentStatus` reports FACTS — the persisted status of the language
 * being edited, and whether a working draft is pending. What to CALL a
 * published document with unsaved edits depends on who has them, and the form
 * cannot answer that for this surface: the block document lives outside the
 * form until the author leaves the editor, so the form's dirty flag is false
 * through an entire editing session. The editor's own history is the honest
 * source, and `pillStateFromForm` is the same derivation the Document panel
 * uses, asked with a different second argument.
 *
 * ## The words are shared and the colours are not
 *
 * `PILL_LABEL` comes from the admin so both editors call the same state by the
 * same name — "Changed" and "Modified" are a distinction the derivation is
 * careful about, and two vocabularies would undo it. The COLOURS are this
 * surface's own: the editor's chrome is drawn from `--nx-builder-*` tokens, and
 * borrowing the admin's warning palette would put a panel's colours on a bar
 * that is not that panel.
 *
 * @module @nextlyhq/plugin-page-builder/admin/DocumentStatusPill
 */

import {
  PILL_LABEL,
  pillStateFromForm,
  useDocumentStatus,
} from "@nextlyhq/plugin-sdk/admin";

export interface DocumentStatusPillProps {
  /**
   * Whether the editor holds edits the document does not have yet.
   *
   * Supplied by the caller rather than read from the form, for the reason in
   * the module docblock: the form does not know.
   */
  isDirty: boolean;
}

/**
 * @param props - whether the editor has uncommitted work
 * @returns the pill, or nothing when no surrounding form published a status
 */
export function DocumentStatusPill({ isDirty }: DocumentStatusPillProps) {
  const status = useDocumentStatus();
  // Nothing rather than a guess. A blocks field also renders inside a create
  // form and inside previews, where no status has been persisted — and a pill
  // reading "Draft" there would be a claim nobody made.
  if (status === null) return null;

  const state = pillStateFromForm(
    status.status,
    isDirty,
    status.hasWorkingDraft
  );
  const live = state === "published";

  return (
    // A plain reading rather than a control: nothing here is pressable, and a
    // pill that looks like a button in a bar full of buttons invites a click
    // that does nothing.
    <span
      className={[
        "border-[color:var(--nx-builder-border)] inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
        // Weight rather than a second hue carries "live", so the distinction
        // survives without colour and in both modes.
        live
          ? "text-[color:var(--nx-builder-text)] font-semibold"
          : "text-[color:var(--nx-builder-text-muted)] font-normal",
      ].join(" ")}
    >
      {/* Named for a reader, because "Draft" alone in a toolbar does not say
          what it describes. */}
      <span className="sr-only">Page status: </span>
      {PILL_LABEL[state]}
    </span>
  );
}
