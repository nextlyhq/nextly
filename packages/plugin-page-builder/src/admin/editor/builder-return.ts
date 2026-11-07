/**
 * Where the entry form picks up when the author leaves the Page Builder: the
 * field the builder was open on, scrolled into view with its way back in
 * focused, so leaving lands the author where they went in.
 *
 * The builder remembers the field by its ADDRESS as it leaves, and the form's
 * fields each ask, as they mount, whether they are it. Inside a repeater the
 * address names the row by its saved id, so the field that answers is the one
 * in the same row wherever that row now stands: a reorder made since does not
 * hand the focus to whichever row took its place.
 *
 * Held in memory for one hand-over: a reload, or a field that never mounts
 * (its row collapsed or removed), leaves nothing behind but one stale entry
 * the next leave replaces.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/builder-return
 */
import type { DocumentIdentity } from "@nextlyhq/plugin-sdk/admin";

/** The field to return to: which document, and the field's address in it. */
interface ReturnTarget {
  readonly document: string;
  readonly field: string;
}

let pending: ReturnTarget | null = null;

/**
 * One key per document. JSON rather than a joined string, since a slug and an
 * id are free text here and a delimiter inside either would make two
 * documents one key.
 */
function documentKey(identity: DocumentIdentity): string {
  return JSON.stringify([
    identity.kind,
    identity.slug,
    identity.documentId ?? null,
  ]);
}

/**
 * Remember, as the builder is left, the field it was open on: `field` is its
 * address (`sections.<rowId>.body`), never its form path. Outside a document
 * there is no form to return to, and nothing is remembered.
 */
export function rememberBuilderReturn(
  identity: DocumentIdentity | null,
  field: string
): void {
  pending =
    identity === null ? null : { document: documentKey(identity), field };
}

/**
 * Whether the field at `field` (its address) on this document is the one the
 * builder was just left from. True once: the first field that answers takes
 * the return, so a second render or another copy of the form does not move
 * the focus again.
 */
export function claimBuilderReturn(
  identity: DocumentIdentity | null,
  field: string
): boolean {
  if (pending === null || identity === null) return false;
  if (pending.document !== documentKey(identity) || pending.field !== field) {
    return false;
  }
  pending = null;
  return true;
}
