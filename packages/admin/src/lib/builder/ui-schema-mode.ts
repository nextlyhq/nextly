/**
 * UI-schema write-mode gate for the admin schema builder (spec §4.12).
 *
 * The builder is dev-only. When this mode is active, "Save" writes the
 * committable `ui-schema.json` manifest via the dev API instead of applying
 * directly to the database. Opt-in (flag, default off) so the existing
 * DB-apply dev flow is unchanged until a project adopts the JSON workflow.
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

/** True when builder saves should write ui-schema.json (dev + opt-in flag). */
export function isUiSchemaWriteMode(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_NEXTLY_UI_SCHEMA_WRITE === "1"
  );
}
