// Why: page-local config for the field group builder. Per the per-kind audit:
// - Field groups have a Name (labeled "Singular name" in the modal but the
//   user is naming the field group itself), Description, Icon. Slug is
//   auto from name and used as the field group identifier.
// - Advanced has Category (Field-group-specific grouping, replaces
//   Collection's adminGroup) and i18n placeholder. NO Order, useAsTitle,
//   Status (Field groups are reusable building blocks, not records),
//   Timestamps.
// - No Hooks button — Field groups don't support hooks (audit).
// - Schema-change preview disabled — Field groups have no rows of their
//   own; mutations apply directly.
// - No excluded picker types per the audit (the spec speculated about
//   restricting `relationship`/`blocks` but the current code doesn't).
import type { BuilderConfig } from "@admin/components/features/schema-builder/builder-config";

export const COMPONENT_BUILDER_CONFIG: BuilderConfig = {
  kind: "field-group",
  basicsFields: ["singularName", "slug", "description", "icon"],
  // showSystemFields added in PR B so field groups also surface the toggle.
  advancedFields: ["category", "i18n", "showSystemFields"],
  toolbar: { previewSchemaChange: false },
  picker: {},
};
