/**
 * Whether a form's unsaved edits change a field every language shares: what a one-click publish
 * would put live in every language, unannounced. Free of React, so every case is tested without
 * rendering anything.
 *
 * Compared by value with what the form started from, as the form's own unsaved state is, rather
 * than by which fields were touched: work a field holds apart from the form reaches its values
 * only as a press readies it. A field is shared or translated as a whole, as the server stores
 * it: a named group or a repeater that is not translated is shared with everything in it.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/shared-edits
 */

import { sameFieldValue } from "../../versions/same-form-value";

type FormValues = Readonly<Record<string, unknown>>;

/** The part of a field this module reads, the same for an entry's fields and a Single's. */
interface EditedField {
  type?: string;
  name?: string;
}

/**
 * Whether a field every language shares, one not among the `translated`, holds another value
 * than the form started from.
 */
export function editsSharedFields(args: {
  /** The fields that hold a value of their own, those inside nameless layouts among them. */
  fields: readonly EditedField[];
  translated: readonly string[];
  startedFrom: FormValues;
  current: FormValues;
}): boolean {
  return args.fields.some(
    ({ name, type }) =>
      name !== undefined &&
      !args.translated.includes(name) &&
      !sameFieldValue(type, args.startedFrom[name], args.current[name])
  );
}
