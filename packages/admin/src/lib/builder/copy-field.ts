/**
 * A copy of a field that is a new field all the way down.
 *
 * The Builder finds a field by its id to edit, delete or add into it, and acts
 * on every field holding that id. So a copy is only independent of what it was
 * copied from when the copy and every field inside it, at any depth, carry ids
 * of their own; a copy whose inner fields kept the originals' ids would change
 * the original along with it, and Save would write both.
 *
 * @module lib/builder/copy-field
 */
import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { generateFieldId } from "./field-transformers";

/** Gives `field` and every field inside it a new id, in place. */
function reidentify(field: BuilderField): BuilderField {
  field.id = generateFieldId();
  field.fields?.forEach(reidentify);
  return field;
}

/**
 * `field` copied with new ids for it and every field inside it, and nothing
 * shared with the original: a deep copy, so editing one never edits the other.
 */
export function copyWithNewIds(field: BuilderField): BuilderField {
  return reidentify(structuredClone(field));
}
