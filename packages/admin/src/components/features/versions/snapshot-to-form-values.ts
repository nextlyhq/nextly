/**
 * Reads a stored version snapshot into the shape the editor's inputs expect.
 *
 * A snapshot is captured from the persisted row rather than from the
 * deserialized read model, so it carries raw storage shapes: JSON-backed types
 * arrive as text on SQLite and as objects on Postgres and MySQL, and a boolean
 * can be `true`, `"true"`, `1` or `"1"`. Handing that straight to a control
 * that expects a runtime value renders a structured field empty rather than
 * showing what it held.
 *
 * The coercion is `normalizeStoredValue`, which already answers this question
 * for the diff and the value kit. It is reused rather than reimplemented: its
 * own header records that three earlier copies disagreed about the fallback,
 * and a fourth would be the same mistake again.
 *
 * @module components/features/versions/snapshot-to-form-values
 */

import type { FieldConfig } from "nextly/config";

import { normalizeStoredValue } from "./value-display/normalize-stored-value";

/** A field with a name of its own, under which it stores its value. */
export type NamedField = FieldConfig & { name: string };

function isNamed(field: FieldConfig): field is NamedField {
  return typeof field.name === "string" && field.name.length > 0;
}

/** A layout container: it has children and stores them at its OWN level. */
function presentationalChildren(field: FieldConfig): FieldConfig[] | null {
  const children = (field as { fields?: FieldConfig[] }).fields;
  return !field.name && Array.isArray(children) ? children : null;
}

/**
 * The fields that hold a value of their own, in form order: a nameless
 * container's children stand in for it, since they store their values at its
 * level. One walk for every reading of a version into the form.
 */
export function formFieldsOf(fields: FieldConfig[]): NamedField[] {
  const named: NamedField[] = [];
  const visit = (list: FieldConfig[]): void => {
    for (const field of list) {
      const children = presentationalChildren(field);
      if (children) {
        visit(children);
        continue;
      }
      if (isNamed(field)) named.push(field);
    }
  };
  visit(fields);
  return named;
}

/**
 * Snapshot values keyed the way the form reads them.
 *
 * A field the snapshot has no value for is left OUT rather than set to null:
 * an absent key lets each input apply its own empty representation, where an
 * explicit null makes a controlled input uncontrolled and reads to React as a
 * mistake. Both render as blank, which is the truthful reading either way.
 */
export function snapshotToFormValues(
  fields: FieldConfig[],
  snapshot: unknown
): Record<string, unknown> {
  const stored =
    typeof snapshot === "object" && snapshot !== null
      ? (snapshot as Record<string, unknown>)
      : {};

  const values: Record<string, unknown> = {};
  // A nameless container — a tab set, a row, a presentational group — holds no
  // value of its own and stores its children beside it, so its children are
  // read against the same object.
  for (const field of formFieldsOf(fields)) {
    const normalized = normalizeStoredValue(field, stored[field.name]);
    if (normalized !== null) values[field.name] = normalized;
  }
  return values;
}
