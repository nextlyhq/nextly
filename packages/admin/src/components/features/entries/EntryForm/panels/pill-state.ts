/**
 * The document's state as a pill and a sentence read it: Draft, Published,
 * Changed, or Modified.
 *
 * Its own module so the panel's Status section and the panel itself read one
 * rule without importing each other.
 *
 * @module components/features/entries/EntryForm/panels/pill-state
 */

/**
 * Derive the displayed pill state from the persisted status, the form dirty
 * flag, and whether a working draft is pending.
 *
 * - "Changed" — a published entry with a persisted working draft waiting to be
 *   promoted (Payload's model). This is the authoritative divergence from live,
 *   so it wins over "Modified": the enabled Save button already signals any
 *   extra unsaved local edits.
 * - "Modified" — a published entry with local edits not yet saved. Drafts never
 *   show Modified (they are inherently work-in-progress).
 */
export type PillState = "draft" | "modified" | "changed" | "published";

/**
 * What each state is CALLED, in one place.
 *
 * Exported because the page builder covers this panel and has to report the
 * same document in the same words. Two maps of four strings agree on the day
 * they are written and drift the first time one of them is reworded, and the
 * result is one editor calling a document "Changed" while another calls it
 * "Modified" — a distinction `pillStateFromForm` is careful to make.
 */
export const PILL_LABEL: Record<PillState, string> = {
  draft: "Draft",
  modified: "Modified",
  changed: "Changed",
  published: "Published",
};
export function pillStateFromForm(
  status: string | undefined,
  isDirty: boolean,
  hasWorkingDraft = false
): PillState {
  if (status === "published" && hasWorkingDraft) return "changed";
  if (status === "published" && isDirty) return "modified";
  return status === "published" ? "published" : "draft";
}
