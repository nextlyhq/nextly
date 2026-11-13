/**
 * The `title` and `slug` every collection's entries carry without declaring
 * them: columns the table is built with, left out of the stored field list.
 *
 * Added back wherever a reader needs them as fields: the admin's entry form
 * draws them, and a binding on a page reads them. One list, so those readers
 * cannot name the two differently.
 *
 * Pure, with no service imports, so the public reader can load it.
 *
 * @module domains/collections/system-text-fields
 */
import type { FieldDefinition } from "../../schemas/dynamic-collections/legacy-types";

const TITLE_FIELD: FieldDefinition = {
  name: "title",
  type: "text",
  label: "Title",
  required: true,
  admin: {
    placeholder: "Enter title",
  },
};

const SLUG_FIELD: FieldDefinition = {
  name: "slug",
  type: "text",
  label: "Slug",
  required: true,
  unique: true,
  admin: {
    placeholder: "my-entry-slug",
  },
  validation: {
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    message: "Slug must be lowercase with hyphens only (e.g., my-entry-slug)",
  },
};

/** The names of the system `title` and `slug`, in the order they are added. */
export const SYSTEM_TEXT_FIELD_NAMES: readonly string[] = [
  TITLE_FIELD.name,
  SLUG_FIELD.name,
];

/**
 * `fields` with the system `title` and `slug` first, each skipped where the
 * author declared a field of that name, which replaces the system column.
 */
export function withSystemTextFields<T extends { name?: unknown }>(
  fields: readonly T[]
): (T | FieldDefinition)[] {
  const declares = (name: string): boolean =>
    fields.some(field => field.name === name);
  return [
    ...(declares("title") ? [] : [TITLE_FIELD]),
    ...(declares("slug") ? [] : [SLUG_FIELD]),
    ...fields,
  ];
}
