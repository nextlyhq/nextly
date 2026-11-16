import type { BuilderField } from "@admin/components/features/schema-builder/types";

/**
 * Default system fields present in every collection and single.
 * These cannot be deleted or renamed by the user.
 * Used by collection/single create pages (prepopulated) and edit pages (prepended to loaded fields).
 */
export const DEFAULT_SYSTEM_FIELDS: BuilderField[] = [
  {
    id: "system_title",
    name: "title",
    label: "Title",
    type: "text",
    isSystem: true,
    validation: { required: true },
  },
  {
    id: "system_slug",
    name: "slug",
    label: "Slug",
    type: "text",
    isSystem: true,
    validation: { required: true },
  },
];

/**
 * The names the system fields above occupy. Derived rather than restated so a
 * change to that list cannot leave a loader filtering one set and a save
 * filtering another. Which names a field may not take is the save's own
 * field-name rule (`fieldNameProblem` on `nextly/config`), not a list here.
 */
export const SYSTEM_FIELD_NAMES: string[] = DEFAULT_SYSTEM_FIELDS.map(
  f => f.name
);
