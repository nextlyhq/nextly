/**
 * Where a field sits in a Builder field tree: the containers above it,
 * outermost first, and the fields beside it.
 *
 * The settings panel reads both. The containers give the path the API returns
 * the field by and whether it sits in repeating rows; the fields beside it are
 * the ones its condition may read, since the entry form evaluates a condition
 * against the fields stored beside it: every named field on its level, those
 * inside a container with no name of its own among them, as that container
 * keeps its fields on the level holding it.
 *
 * @module lib/builder/field-placement
 */
import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { namedFieldsIn, namingLevel } from "./move-rule";

export interface FieldPlacement {
  field: BuilderField;
  /** The containers holding the field, outermost first; empty at the top. */
  ancestors: BuilderField[];
  /**
   * The other named fields on its level: in its container, or at the top
   * level, through any container with no name between, which is where the
   * entry form reads a condition's source.
   */
  siblings: BuilderField[];
}

/** The field with this id and where it sits, or `null` when no field has it. */
export function findFieldPlacement(
  fields: readonly BuilderField[],
  fieldId: string
): FieldPlacement | null {
  const found = findWithAncestors(fields, fieldId, []);
  if (!found) return null;
  const level = namingLevel(found.ancestors);
  const onLevel = namedFieldsIn(level ? (level.fields ?? []) : fields);
  return {
    ...found,
    siblings: onLevel.filter(other => other.id !== fieldId),
  };
}

/** The field with this id and the containers above it, outermost first. */
function findWithAncestors(
  fields: readonly BuilderField[],
  fieldId: string,
  ancestors: BuilderField[]
): Omit<FieldPlacement, "siblings"> | null {
  for (const field of fields) {
    if (field.id === fieldId) return { field, ancestors };
    if (field.fields && field.fields.length > 0) {
      const found = findWithAncestors(field.fields, fieldId, [
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
