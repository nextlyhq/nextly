/**
 * UI-schema field-type allowlist for the admin schema builder.
 *
 * The builder always dual-writes — every create/edit/delete applies to the dev
 * DB and mirrors to the committable `ui-schema.json` — so there is no longer a
 * mode flag. This module just owns the canonical field-type set the picker and
 * the manifest mappers share with the package zod schema.
 *
 * @module lib/builder/ui-schema-mode
 * @since v0.0.3-alpha (Plan D4)
 */

/**
 * Field types supported by `ui-schema.json`. Mirrors the package
 * `UI_FIELD_TYPES` in packages/nextly/src/schemas/_zod/ui-schema.ts — keep the
 * two lists in lockstep (the package zod is the source of truth; a UI field of
 * any of these round-trips through `getColumnDescriptor` with no translation).
 */
export const UI_SCHEMA_FIELD_TYPES = [
  // original v1 subset
  "text",
  "textarea",
  "richText",
  "number",
  "checkbox",
  "date",
  "select",
  "relationship",
  "upload",
  // widened to the full canonical set
  "email",
  "password",
  "code",
  "radio",
  "repeater",
  "group",
  "component",
  "json",
  "chips",
] as const;

export type UiSchemaFieldType = (typeof UI_SCHEMA_FIELD_TYPES)[number];
