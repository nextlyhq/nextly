/**
 * What the preview would render, as a value that changes when it does.
 *
 * One function rather than an expression at the call site, because it answers a
 * question with more than one part and getting either part wrong is silent: the
 * frame simply keeps showing content that is no longer there.
 *
 * @module components/features/entries/PreviewMode/previewRevision
 */

import { hasPendingWorkingDraft } from "../EntryForm/EntryFormContext";

/**
 * The document's own modification time, as a comparable string.
 *
 * Both spellings are accepted for the reason `DocumentPanel` accepts both: the
 * shape depends on how the row was read, and a reader that knows only one
 * returns the empty string for the other — which compares equal to itself
 * forever and would make the revision stop moving rather than fail loudly.
 *
 * A `Date` is normalised rather than stringified by default, because
 * `String(new Date())` drops sub-second precision and two saves inside the same
 * second would compare equal.
 */
function modifiedAt(document: unknown): string {
  const row = document as
    | { updatedAt?: unknown; updated_at?: unknown }
    | null
    | undefined;
  const raw = row?.updatedAt ?? row?.updated_at;
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "number") return String(raw);
  return "";
}

/**
 * DERIVED from the document rather than notified by whoever wrote it.
 *
 * A form submission is not the only write. Discarding a working draft and
 * restoring a version each persist through their own mutation, so a token
 * bumped by the submit handler leaves the frame showing content that was just
 * discarded. Deriving means a write nobody remembered to announce still moves
 * the value — the difference between covering the writes that were listed and
 * covering the writes there are.
 *
 * TWO facts, because the preview route reads both. `updatedAt` moves on a save
 * and on a version restore, which resubmits through the ordinary update path.
 * It does NOT move when a working draft is discarded — the draft is a separate
 * row from the published one — and that discard changes what the preview
 * renders, because the route reads the draft overlay. Either fact alone misses
 * a write the frame would then keep showing.
 */
export function previewRevisionOf(document: unknown): string {
  return `${modifiedAt(document)}|${hasPendingWorkingDraft(document)}`;
}
