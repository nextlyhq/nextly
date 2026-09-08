/**
 * What a human calls ONE entry of a collection.
 *
 * 🔴 One implementation, because the answer is read in two places that must
 * agree: the button that opens a create form, and the form itself. Two
 * resolutions agree on the day they are written and drift afterwards, and the
 * drift is silent -- a shortcut reading "New Blog Posts" opening a page headed
 * "New Article" looks like two features rather than one bug.
 *
 * The order is the author's declared singular first, then the display label,
 * then the slug. `labels.singular` is the only one of the three that is
 * ACTUALLY singular: `label` is whatever the collection is called in the
 * sidebar, which is usually plural, and the slug is a storage identifier.
 *
 * Structurally typed rather than taking a named collection interface, because
 * the callers hold different shapes of the same row -- the API's `ApiCollection`
 * and the entry form's narrower `EntryFormCollection` -- and neither should
 * have to convert to ask a question about three of its own fields.
 *
 * @module lib/collection-label
 */

export interface CollectionNaming {
  name: string;
  label?: string;
  labels?: { singular?: string; plural?: string };
}

/** The singular label, falling back to the display label and then the slug. */
export function collectionSingularLabel(collection: CollectionNaming): string {
  return collection.labels?.singular || collection.label || collection.name;
}
