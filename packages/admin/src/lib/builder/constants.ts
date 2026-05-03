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

/**
 * Single source of truth for reserved field names.
 * New user-defined fields cannot use these names because they collide with
 * built-in or framework-managed columns. Replaces ad-hoc per-call filtering
 * (e.g. `[slug].tsx` filtering by name vs by isSystem) noted in the audit.
 */
export const RESERVED_NAMES = [
  "id",
  "title",
  "slug",
  "createdAt",
  "updatedAt",
  "status",
] as const;

export type ReservedFieldName = (typeof RESERVED_NAMES)[number];

/**
 * Case-sensitive check — `Title` is allowed, `title` is reserved.
 * The DB columns are camelCase, so case-sensitivity is the right safety bar.
 */
export function isReservedFieldName(name: string): name is ReservedFieldName {
  return (RESERVED_NAMES as readonly string[]).includes(name);
}
