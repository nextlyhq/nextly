/**
 * Whether an editor reads a collection's held draft in place of its live
 * document: when the collection holds drafts, and when it stopped holding
 * them only because it reaches a translated component (`localized-component`)
 * and so may still hold one saved before. Such a draft stays shown, and the
 * editor can publish or discard it.
 *
 * @module lib/held-draft
 */

/** What a collection's schema says about its drafts. */
interface DraftsOfCollection {
  draftsEnabled?: boolean;
  draftsDisabledReason?: string;
}

/** Whether the editor asks for this collection's held draft. */
export function readsHeldDraft(
  collection: DraftsOfCollection | null | undefined
): boolean {
  return (
    collection?.draftsEnabled === true ||
    collection?.draftsDisabledReason === "localized-component"
  );
}
