import type { BuilderField } from "@admin/components/features/schema-builder";

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
