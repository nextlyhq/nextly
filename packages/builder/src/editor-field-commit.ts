/**
 * Commits the field that has focus in a variable or Site text editor, by
 * leaving it, as Tab would: each field commits on blur, synchronously. Called
 * before an editor closes, since a click outside closes it before the
 * field's own blur, and the value typed there would otherwise be lost.
 *
 * @module editor-field-commit
 */
import { isHTMLElement } from "./dom-kind";

export function commitFocusedField(document: Document | undefined): void {
  const active = document?.activeElement;
  if (isHTMLElement(active) && active.closest(".nx-vars-editor")) {
    active.blur();
  }
}
