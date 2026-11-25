/**
 * Whether a form's unsaved edits change what every language shares: what a one-click publish
 * would put live in every language, unannounced. Free of React, so every case is tested without
 * rendering anything.
 *
 * Compared by value with what the form started from, as the form's own unsaved state is, rather
 * than by which fields were touched: work a field holds apart from the form reaches its values
 * only as a press readies it.
 *
 * What is shared follows how the server stores it:
 * - a field is shared or translated as a whole, unless it keeps one structure in every language;
 * - a named repeater or group, or a component, does: its rows or instances, their order and the
 *   untranslated values inside are shared, and the text inside is the language's own;
 * - a nameless layout's fields are stored beside it on the shared row, where only the declared
 *   fields are kept per language, so its text is shared. A component in one is stored apart from
 *   the row, as a component beside it is.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/shared-edits
 */

import type { FieldConfig } from "nextly/config";
import { isFieldGroupFieldType } from "nextly/field-group-type";

import { sameFieldValue } from "../../versions/same-form-value";
import { formFieldsWithin } from "../../versions/snapshot-to-form-values";
import { withTextFrom } from "../container-text";
import { localizedFieldNamesOf } from "../entry-locale-source";

type FormValues = Readonly<Record<string, unknown>>;

/**
 * `startedFrom` and `current` with the language's own text inside `fields` made the same in both,
 * so what still differs is shared. Each row and instance is matched as storage matches it, by id:
 * one added, removed, moved or without an id of its own still differs.
 */
function withSameText(
  fields: readonly FieldConfig[],
  localized: boolean,
  startedFrom: FormValues,
  current: FormValues
): { before: FormValues; after: FormValues } {
  // The document read as one level, which is what a group with these fields is.
  const level = { type: "group", fields };
  const onto = (values: FormValues, source: FormValues): FormValues =>
    withTextFrom(values, source, level, localized) as FormValues;
  // A blank text is never copied, so the text is taken both ways: first the current text where
  // there is some, then that, or the text it started with, back onto the current values.
  const before = onto(startedFrom, current);
  return { before, after: onto(current, before) };
}

/** Whether the form holds another value than it started from in what every language shares. */
export function editsSharedFields(args: {
  /** The document's fields, as declared. */
  fields: FieldConfig[];
  /** Whether the document is translated at all. */
  localized: boolean;
  startedFrom: FormValues;
  current: FormValues;
}): boolean {
  const { fields, localized } = args;
  const translated = new Set(localizedFieldNamesOf(fields, localized));
  const shared = formFieldsWithin(fields).filter(
    ({ field, within }) => within.length > 0 || !translated.has(field.name)
  );
  const structured = shared
    .filter(
      ({ field, within }) =>
        within.length === 0 || isFieldGroupFieldType(field.type)
    )
    .map(({ field }) => field);
  const { before, after } = withSameText(
    structured,
    localized,
    args.startedFrom,
    args.current
  );
  return shared.some(
    ({ field: { name, type } }) =>
      !sameFieldValue(type, before[name], after[name])
  );
}
