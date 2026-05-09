// Why: page-local config for the Component builder. Per the per-kind audit:
// - Components have a Name (labeled "Singular name" in the modal but the
//   user is naming the component itself), Description, Icon. Slug is
//   auto from name and used as the component identifier.
// - Advanced has Category (Component-specific grouping, replaces
//   Collection's adminGroup) and i18n placeholder. NO Order, useAsTitle,
//   Status (Components are reusable building blocks, not records),
//   Timestamps.
// - No Hooks button — Components don't support hooks (audit).
// - Schema-change preview disabled — Components have no rows of their
//   own; mutations apply directly.
// - No excluded picker types per the audit (the spec speculated about
//   restricting `relationship`/`blocks` but the current code doesn't).
import type { BuilderConfig } from "@admin/components/features/schema-builder/builder-config";

export const COMPONENT_BUILDER_CONFIG: BuilderConfig = {
  kind: "component",
  basicsFields: ["singularName", "slug", "description", "icon"],
  // showSystemFields added in PR B so components also surface the toggle.
  advancedFields: ["category", "i18n", "showSystemFields"],
  toolbar: { previewSchemaChange: false },
  picker: {},
};
