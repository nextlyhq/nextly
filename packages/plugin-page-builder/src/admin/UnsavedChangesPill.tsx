"use client";

/**
 * Whether the editor is holding work the document does not have yet.
 *
 * A DIFFERENT question from the one {@link DocumentStatusPill} answers, and
 * that is why it is a second reading rather than another state in the first.
 * "Is this page live?" and "is my work saved?" have different answers, they
 * change at different moments, and one of them is undefined on a collection
 * with no publish lifecycle — where the status pill correctly renders nothing
 * and, until this existed, took the save state down with it. An author editing
 * such a page had no reading in the toolbar at all.
 *
 * ## The region is always mounted; only its contents come and go
 *
 * A polite live region is announced when its CONTENTS change, and a region
 * inserted into the document already holding its text is not reliably
 * announced at all — the assistive technology never saw it empty. Since the
 * transition this exists to report is exactly clean-to-dirty, mounting on that
 * transition would lose the one announcement worth making.
 *
 * So the region is unconditional and the reading inside it is not. Empty, it
 * draws nothing: the border, the padding and the dot belong to the inner
 * element, so a document with nothing outstanding shows no chip.
 *
 * ## Silent when there is nothing certain to say
 *
 * The tempting other half — a "Saved" reading when `isDirty` is false — cannot
 * be told apart from a document that was never saved: a blocks field renders
 * inside a create form and inside previews, where the same `false` means
 * "nothing typed yet". The status pill guards that case by refusing to name a
 * status nobody persisted, and this refuses for the same reason. An absent
 * reading says nothing; a wrong one says the work is safe.
 *
 * @module @nextlyhq/plugin-page-builder/admin/UnsavedChangesPill
 */

export interface UnsavedChangesPillProps {
  /**
   * Whether the document holds edits it has not persisted.
   *
   * Derived once by the caller, from the same answer the navigation guard
   * reports, so the two cannot disagree about whether work is outstanding —
   * including while an inline edit is merely OPEN, which moves neither the
   * editor's history nor the form's dirty fields.
   */
  isDirty: boolean;
}

/**
 * @param props - whether the document holds unsaved work
 * @returns a live region, carrying the reading only while work is outstanding
 */
export function UnsavedChangesPill({ isDirty }: UnsavedChangesPillProps) {
  return (
    // `polite` rather than `assertive`: the state changes on almost every edit,
    // and a reading that interrupts on each one is one an author learns to
    // ignore. No styling here — an empty region must occupy nothing.
    <span aria-live="polite">
      {isDirty ? (
        // A reading, not a control: there is no save button in this toolbar to
        // pair it with — blocks reach the entry when the author leaves the
        // editor — so anything pressable would promise an action that does not
        // exist.
        <span className="border-[color:var(--nx-builder-border)] text-[color:var(--nx-builder-text)] inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
          {/* Carries the meaning without colour, for the reason the status pill
              uses weight rather than a second hue. */}
          <span
            aria-hidden="true"
            className="bg-[color:var(--nx-builder-text)] size-1.5 rounded-full"
          />
          Unsaved changes
        </span>
      ) : null}
    </span>
  );
}
