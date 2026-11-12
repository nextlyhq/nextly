/**
 * Where a field sits in a Builder field tree: the containers above it,
 * outermost first, and the fields beside it.
 *
 * The settings panel reads both. The containers give the path the API returns
 * the field by and whether it sits in repeating rows; the fields beside it are
 * the ones its condition may read, since the entry form evaluates a condition
 * against the field's own siblings.
 *
 * @module lib/builder/field-placement
 */
import type { BuilderField } from "@admin/components/features/schema-builder/types";

export interface FieldPlacement {
  field: BuilderField;
  /** The containers holding the field, outermost first; empty at the top. */
  ancestors: BuilderField[];
  /** The other fields in the same container, or at the top level. */
  siblings: BuilderField[];
}

/** The field with this id and where it sits, or `null` when no field has it. */
export function findFieldPlacement(
  fields: readonly BuilderField[],
  fieldId: string,
  ancestors: BuilderField[] = []
): FieldPlacement | null {
  for (const field of fields) {
    if (field.id === fieldId) {
      return {
        field,
        ancestors,
        siblings: fields.filter(other => other.id !== fieldId),
      };
    }
    if (field.fields && field.fields.length > 0) {
      const found = findFieldPlacement(field.fields, fieldId, [
        ...ancestors,
        field,
      ]);
      if (found) return found;
    }
  }
  return null;
}

/** The id of every field in a tree, nested ones included. */
export function collectFieldIds(fields: readonly BuilderField[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: readonly BuilderField[]) => {
    for (const field of list) {
      ids.add(field.id);
      if (field.fields) walk(field.fields);
    }
  };
  walk(fields);
  return ids;
}
