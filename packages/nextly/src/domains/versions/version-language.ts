/**
 * Whether a version of a document carries values kept per language, beyond
 * its own translations.
 *
 * A component's rows are kept per language whether or not the document that
 * embeds it is translated, so a version of a document that stores a component
 * was read in a language, even where the component is empty: it is recorded
 * under that language, as the document's other versions are. One answer for
 * every path that records a version (a create, an update, a held save, a
 * restore's snapshot of what it replaces): asked separately, a held save and a
 * publish once disagreed about an empty component, and the held save's version
 * landed under no language, where nothing looking for that language's draft
 * could find it.
 *
 * @module domains/versions/version-language
 */

import { componentsReached } from "./draft-split-eligibility";

/**
 * Whether a version of a document with these `fields` carries component
 * values, read in a language: true when a stored field reaches a component at
 * any depth, inside a group or a repeater as well as at the top level. A
 * virtual field stores no rows, so a component only it reaches carries none.
 */
export function carriesComponentValues(fields: readonly unknown[]): boolean {
  return componentsReached(fields, null).stored.size > 0;
}
