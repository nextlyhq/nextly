/**
 * What saving one language of a document sends, of its fields of their own
 * (`nested-text` has those inside containers): the translatable fields the
 * translator changed, and which of them were written as original content.
 * Nothing else: a shared field belongs to every language, and a field sent
 * unchanged would be recorded as made again from its source.
 *
 * @module components/features/translations/page/translation-save
 */

import { isFieldTranslated } from "@admin/components/features/entries/translation-meta";
import { sameFieldValue } from "@admin/components/features/versions/same-form-value";

import type { TranslationField } from "./translation-fields";

/** The key a save names where its values came from under. */
export const PROVENANCE_KEY = "_provenance";

/** A value written in its own language rather than made from another. */
export interface ProvenanceClaim {
  origin: "original";
}

/** The fields among `rows` whose value differs from what the form started from. */
export function changedRows(
  rows: readonly TranslationField[],
  values: Readonly<Record<string, unknown>>,
  startedFrom: Readonly<Record<string, unknown>>
): TranslationField[] {
  return rows.filter(
    ({ field, name }) =>
      !sameFieldValue(field.type, values[name], startedFrom[name])
  );
}

/**
 * The body of the save. `sourceOf` is the language each field's source is
 * shown in, or undefined where it has none; a cleared field claims nothing,
 * since nothing was written.
 *
 * A value translated from a language other than the default is recorded
 * against the default one: the server takes no claim naming another source for
 * a person's own words, so `sourceOf` is read only for its absence.
 */
export function translationPayload(
  rows: readonly TranslationField[],
  values: Readonly<Record<string, unknown>>,
  startedFrom: Readonly<Record<string, unknown>>,
  sourceOf: (name: string) => string | undefined
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const claims: Record<string, ProvenanceClaim> = {};
  for (const { name } of changedRows(rows, values, startedFrom)) {
    // An emptied text field is stored as no value, as the editor stores it.
    const value = values[name] === "" ? null : values[name];
    payload[name] = value;
    if (sourceOf(name) === undefined && isFieldTranslated(value)) {
      claims[name] = { origin: "original" };
    }
  }
  return Object.keys(claims).length === 0
    ? payload
    : { ...payload, [PROVENANCE_KEY]: claims };
}
