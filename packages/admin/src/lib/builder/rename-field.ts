/**
 * Whether a saved field can be renamed in the Builder.
 *
 * A saved field's name is its identity: its column and its API key. Rename… changes it as a
 * rename, which the save answers as one, so the field's values are kept. That needs a column of the
 * field's own on the entity's table, which the save can rename. A field inside a named group or a
 * repeater has none: it is a key inside the container's value, and the save cannot tell a renamed
 * key from one removed beside one added, so its values would stay under the old key. A field using
 * a field group keeps its values in that group's own table, under its name. Neither offers Rename….
 *
 * @module lib/builder/rename-field
 */
import { isFieldGroupFieldType } from "nextly/field-group-type";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { namingLevel } from "./move-rule";

/** What the panel says beside a saved field's name that Rename… can change. */
export const RENAME_HOW =
  "A saved field's name changes through Rename…, which keeps its values.";

/**
 * Why `field`, saved where it sits under `ancestors` (outermost first), cannot be renamed, or
 * `null` when Rename… can rename it.
 */
export function renameUnavailableReason(
  field: BuilderField,
  ancestors: readonly BuilderField[]
): string | null {
  const level = namingLevel(ancestors);
  if (level) {
    return `This field is inside ${level.label || level.name}, whose value keeps it by its name, so it cannot be renamed.`;
  }
  if (isFieldGroupFieldType(field.type)) {
    return "This field keeps its values in its field group's own table, under its name, so it cannot be renamed.";
  }
  return null;
}
