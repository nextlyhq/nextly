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

/** A layout container: it has children and stores them at its OWN level. */
function presentationalChildren(field: FieldConfig): FieldConfig[] | null {
  const children = (field as { fields?: FieldConfig[] }).fields;
  return !field.name && Array.isArray(children) ? children : null;
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

  const visit = (list: FieldConfig[]): void => {
    for (const field of list) {
      // A nameless container — a tab set, a row, a presentational group —
      // holds no value of its own and stores its children beside it, so its
      // children are read against the same object.
      const children = presentationalChildren(field);
      if (children) {
        visit(children);
        continue;
      }
      if (!field.name) continue;

      const normalized = normalizeStoredValue(field, stored[field.name]);
      if (normalized !== null) values[field.name] = normalized;
    }
  };

  visit(fields);
  return values;
}
