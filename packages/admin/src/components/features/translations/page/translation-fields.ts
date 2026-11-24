/**
 * Which of a document's fields its translation page shows, and how: the text
 * written per language, a row each; the containers whose text is written per
 * language inside them; and the shared fields, named and edited elsewhere.
 *
 * Read off the document rather than off the schema alone. The server answers a
 * read of every language with the translatable fields the reader may read, and
 * leaves out of it every field they may not, so what it answered is both the
 * classification storage uses and the access rule, and neither is worked out a
 * second time here.
 *
 * @module components/features/translations/page/translation-fields
 */

import type { FieldConfig } from "nextly/config";
import { isFieldGroupFieldType } from "nextly/field-group-type";

import { fieldAdminGates } from "@admin/components/features/entries/fields/field-admin-gates";
import { fieldLabel } from "@admin/lib/field-label";
import { addressableFieldsWithin } from "@admin/lib/plugins/document-view-registry";

/** One field the page names: its declaration, and what it is called. */
export interface TranslationField {
  field: FieldConfig;
  name: string;
  label: string;
}

export interface TranslationFieldSet {
  /** Written here, one value per language. */
  rows: TranslationField[];
  /** Containers holding text per language inside them. */
  nested: TranslationField[];
  /** The same in every language, and edited in the editor. */
  shared: TranslationField[];
}

/** Each translatable field's stored value in each language the reader may read. */
export type ValuesPerLanguage = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The values per language a read of every language carries. */
export function valuesPerLanguage(
  document: Readonly<Record<string, unknown>>
): ValuesPerLanguage {
  const every = document._allLocales;
  if (!isRecord(every)) return {};
  const values: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [name, byLanguage] of Object.entries(every)) {
    if (isRecord(byLanguage)) values[name] = byLanguage;
  }
  return values;
}

/** Field types whose value is other fields' values. */
const CONTAINER_TYPES: ReadonlySet<string> = new Set([
  "group",
  "repeater",
  "blocks",
]);

function isContainer(field: FieldConfig): boolean {
  // Widened: a plugin contributes types the catalog's own union does not name.
  const type: string = field.type;
  return CONTAINER_TYPES.has(type) || isFieldGroupFieldType(type);
}

function labelOf(field: FieldConfig, name: string): string {
  const label = "label" in field ? field.label : undefined;
  return fieldLabel({
    name,
    label: typeof label === "string" ? label : undefined,
  });
}

/**
 * The document's fields as its translation page shows them, in the form's own
 * order: its top-level fields, those of an unnamed group among them. `document`
 * is a read of every language. A hidden field is not shown, as in the form.
 */
export function translationFields(
  fields: readonly FieldConfig[],
  document: Readonly<Record<string, unknown>>
): TranslationFieldSet {
  const perLanguage = valuesPerLanguage(document);
  const set: TranslationFieldSet = { rows: [], nested: [], shared: [] };
  for (const { field, path, within } of addressableFieldsWithin(fields)) {
    if (path === "") continue;
    if ([...within, field].some(each => fieldAdminGates(each).hidden)) continue;
    const shown = { field, name: path, label: labelOf(field, path) };
    if (Object.hasOwn(perLanguage, path)) {
      (isContainer(field) ? set.nested : set.rows).push(shown);
    } else if (Object.hasOwn(document, path)) {
      set.shared.push(shown);
    }
  }
  return set;
}
