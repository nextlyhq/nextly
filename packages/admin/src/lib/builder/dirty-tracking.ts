/**
 * Dirty-tracking helpers for the schema builder.
 *
 * The previous implementation diffed only the ID list of user fields, so
 * label / width / validation / options edits never bumped the unsaved
 * badge -- leaving Save Schema disabled when it shouldn't be. This module
 * normalizes each field to a deterministic JSON signature covering the
 * full editable shape, then compares signatures by ID.
 *
 * @module lib/builder/dirty-tracking
 */
import type { BuilderField } from "@admin/components/features/schema-builder/types";

// Why: BuilderField has many optional properties. We list the editable ones
// explicitly so signatureOf is stable: a key not on this list is invisible
// to dirty tracking. When BuilderField gains a new editable property, add it
// here too.
const FIELD_SHAPE_KEYS: ReadonlyArray<keyof BuilderField> = [
  "name",
  "label",
  "type",
  "description",
  "defaultValue",
  "hasMany",
  "options",
  "validation",
  "admin",
  "advanced",
  // Relationship
  "relationTo",
  "maxDepth",
  "allowCreate",
  "allowEdit",
  "isSortable",
  "relationshipFilter",
  // Upload
  "mimeTypes",
  "maxFileSize",
  "displayPreview",
  // Array / Group
  "labels",
  "initCollapsed",
  "rowLabelField",
  // Component
  "component",
  "components",
  "repeatable",
  // Blocks (nested fields handled separately to support recursion)
  "blocks",
];

/**
 * Build a deterministic JSON signature for one field. Recurses into
 * nested `fields` (repeater/group/component) so child edits count too.
 */
function signatureOf(field: BuilderField): string {
  const shape: Record<string, unknown> = {};
  for (const key of FIELD_SHAPE_KEYS) {
    const value = field[key];
    shape[key] = value === undefined ? null : value;
  }
  // Why: nested children get their own recursive signature so a label edit
  // inside a repeater bumps the parent's signature.
  shape.fields = (field.fields ?? []).map(signatureOf);
  return JSON.stringify(shape);
}

/**
 * Count how many user fields have changed between original and current.
 * Counts: added + removed + modified (each as 1).
 *
 * Caller MUST pre-filter system fields out of both arrays so this helper
 * stays type-pure and doesn't depend on the BuilderField.isSystem flag.
 */
export function countDirtyFields(
  original: readonly BuilderField[],
  current: readonly BuilderField[]
): number {
  const originalById = new Map(original.map(f => [f.id, signatureOf(f)]));
  const currentById = new Map(current.map(f => [f.id, signatureOf(f)]));

  let count = 0;
  for (const [id, sig] of currentById) {
    const orig = originalById.get(id);
    if (orig === undefined) {
      count++; // added
    } else if (orig !== sig) {
      count++; // modified
    }
  }
  for (const id of originalById.keys()) {
    if (!currentById.has(id)) {
      count++; // removed
    }
  }
  return count;
}
