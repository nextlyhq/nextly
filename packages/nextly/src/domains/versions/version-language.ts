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

import { isFieldGroupField } from "../../collections/fields/guards";
import { isVirtualField } from "../../collections/fields/virtual";

/** What {@link carriesComponentValues} reads of a field. */
interface VersionField {
  readonly type: string;
  readonly virtual?: unknown;
  readonly options?: unknown;
}

/**
 * Whether a version of a document with these top-level `fields` carries
 * component values, read in a language: true when one stores a component. A
 * virtual component field stores no rows, so it carries none.
 */
export function carriesComponentValues(
  fields: readonly VersionField[]
): boolean {
  return fields.some(
    field => isFieldGroupField(field) && !isVirtualField(field)
  );
}
