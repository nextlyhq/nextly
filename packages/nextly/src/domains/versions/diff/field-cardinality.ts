/**
 * Whether a field holds one value or a list of rows.
 *
 * Kept apart from the diff engine so that code asking only this, such as the
 * redaction's path naming in `component-read-access.ts`, does not load the
 * engine and its text and rich-text diffing to ask it.
 *
 * @module domains/versions/diff/field-cardinality
 */

import type { FieldConfig } from "../../../collections/fields/types";
import { isFieldGroupFieldType } from "../../field-groups/storage/field-group-field-type";

export function isComponentField(field: FieldConfig): boolean {
  return isFieldGroupFieldType(field.type);
}

function isRepeatable(field: FieldConfig): boolean {
  return (field as { repeatable?: boolean }).repeatable === true;
}

/** Cardinality is decided by `repeatable`; a non-repeatable field holds one value. */
export function isComponentList(field: FieldConfig): boolean {
  return isComponentField(field) && isRepeatable(field);
}

/**
 * Whether a field holds a list of rows, by its cardinality rather than by the
 * shape its value arrives in: a non-repeatable component populated from its
 * own table arrives as a one-element array and still holds one value. Shared
 * with the redaction's path naming, so a path names a row by index exactly
 * where the diff reads rows.
 */
export function isListField(field: FieldConfig): boolean {
  return field.type === "repeater" || isComponentList(field);
}
