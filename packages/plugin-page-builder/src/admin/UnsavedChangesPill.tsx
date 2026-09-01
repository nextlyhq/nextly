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
 * ## Silent when there is nothing certain to say
 *
 * Rendered only while work IS outstanding. The tempting other half — a
 * "Saved" reading when `isDirty` is false — cannot be told apart from a
 * document that was never saved: a blocks field renders inside a create form
 * and inside previews, where the same `false` means "nothing typed yet". The
 * status pill guards that case by refusing to name a status nobody persisted,
 * and this refuses for the same reason. An absent reading says nothing; a
 * wrong one says the work is safe.
 *
 * That asymmetry is deliberate rather than a gap: the state worth interrupting
 * an author for is the one where leaving loses something.
 *
 * @module @nextlyhq/plugin-page-builder/admin/UnsavedChangesPill
 */

export interface UnsavedChangesPillProps {
  /**
   * Whether the document holds edits it has not persisted.
   *
   * The same value the status pill reads, derived once by `useDocumentDirty`
   * so the two readings cannot disagree about whether work is outstanding.
   */
  isDirty: boolean;
}

/**
 * @param props - whether the document holds unsaved work
 * @returns the reading, or nothing while everything is committed
 */
export function UnsavedChangesPill({ isDirty }: UnsavedChangesPillProps) {
  if (!isDirty) return null;

  return (
    // A reading, not a control: there is no save button in this toolbar to
    // pair it with — blocks reach the entry when the author leaves the editor —
    // so anything pressable here would promise an action that does not exist.
    <span
      className="border-[color:var(--nx-builder-border)] text-[color:var(--nx-builder-text)] inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
      // `polite` rather than `assertive`: the state changes on almost every
      // edit, and a reading that interrupts on each keystroke is noise an
      // author would learn to ignore.
      aria-live="polite"
    >
      {/* Carries the meaning without colour, for the reason the status pill
          uses weight rather than a second hue. */}
      <span
        aria-hidden="true"
        className="bg-[color:var(--nx-builder-text)] size-1.5 rounded-full"
      />
      Unsaved changes
    </span>
  );
}
