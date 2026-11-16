/**
 * The document actions that put a document live, by id: the ones the blocks
 * field asks about before they store (`publish-offer.tsx`), and the ones the
 * admin entry holds while that field's code is on its way (`lazy-part.tsx`).
 *
 * A module of its own so the entry can name them without importing the
 * question's dialog.
 *
 * @module admin/publishing-actions
 */
export const PUBLISHING_ACTIONS: ReadonlySet<string> = new Set(["publish"]);
