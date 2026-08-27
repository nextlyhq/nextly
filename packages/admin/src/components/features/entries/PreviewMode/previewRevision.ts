/**
 * What the preview would render, as a value that changes when it does.
 *
 * One function rather than an expression at the call site, because it answers a
 * question with more than one part and getting any part wrong is silent: the
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
 * THREE facts, because no two of them cover the writes the third does.
 *
 * Derived from the document, and counted from this form's own saves, because
 * each half is blind to writes the other sees.
 *
 * `updatedAt` moves on a save and on a version restore, which resubmits through
 * the ordinary update path. It does NOT move when a working draft is discarded
 * — the draft is a separate row from the published one — and that discard
 * changes what the preview renders, because the route reads the draft overlay.
 * So `hasPendingWorkingDraft` is read too.
 *
 * And BOTH derived facts stand still for the case that turns out to be the
 * ordinary one: editing a published entry. A status-less save of a published,
 * drafts-enabled document writes the working-draft sidecar and leaves the live
 * row alone, and `shapeDraftForResponse` then copies the LIVE parent's
 * timestamps onto the response — so after the first such save `_isWorkingDraft`
 * is already `true` and `updatedAt` is frozen at the published row's value.
 * Every later draft save changes the content and moves neither fact. The
 * sidecar does carry its own advancing `updatedAt`, but it never leaves the
 * server, so no amount of care with the document can recover it.
 *
 * `savedCount` closes exactly that gap and nothing else. It is a NOTIFICATION,
 * which is the weaker kind of evidence and why it is not the whole answer: it
 * knows only about writes this form performed, so a discard, a restore, or
 * another author's change would move nothing if it were used alone. The derived
 * facts cover those. Used together each covers the other's blind spot — writes
 * nobody announced, and announced writes that move nothing observable.
 *
 * A save the server treated as a no-op still bumps the count, costing one
 * reload of identical content. That is the safe direction: a reload is a
 * remount of an existing credential, while a missed change is a preview that
 * quietly stops matching the document.
 */
export function previewRevisionOf(
  document: unknown,
  savedCount: number
): string {
  return `${modifiedAt(document)}|${hasPendingWorkingDraft(document)}|${savedCount}`;
}
