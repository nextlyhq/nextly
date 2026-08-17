/**
 * Keeps a field's DOM id unique when the same document is rendered twice.
 *
 * A field's element id is its path, which is unique within one form and not
 * within one page. That was harmless while a document appeared once. It stops
 * being harmless as soon as a second rendering exists — a version preview
 * beside the live editor — because `getElementById` answers with the first
 * match: every `<label for>` in the second rendering then points at the FIRST
 * rendering's control. The duplicated fields lose their accessible name, and
 * clicking a label in a read-only view moves focus into the editable document.
 *
 * A scope is an opaque prefix supplied by whoever renders the second copy. The
 * default is empty, so the live editor's ids are exactly what they were and
 * nothing that reads them has to change.
 *
 * @module components/features/entries/fields/field-id-scope
 */

import { createContext, useContext } from "react";

/**
 * The prefix applied to every field element id below this point. Empty means
 * "this is the only rendering of the document", which is the common case.
 */
export const FieldIdScopeContext = createContext("");

/**
 * The DOM id a field's control should carry.
 *
 * Callers pass the identifier they would otherwise have used, so an unscoped
 * tree keeps byte-identical ids and a scoped one cannot collide with it.
 */
export function useFieldElementId(id: string): string {
  const scope = useContext(FieldIdScopeContext);
  return scope ? `${scope}-${id}` : id;
}
