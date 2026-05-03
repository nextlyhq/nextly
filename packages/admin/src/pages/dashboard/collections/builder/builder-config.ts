// Why: page-local config that drives the shared schema-builder components
// for the Collection builder. The per-kind audit
// (docs/superpowers/findings/2026-05-02-builder-per-kind-audit.md) confirms:
// - All Basics fields apply (Singular + Plural + Slug + Description + Icon).
// - Advanced has Admin group + Order + useAsTitle + Status (Draft/Published)
//   + i18n placeholder + Timestamps. No Category (that's Components only).
// - Hooks button visible. Schema-change preview runs on save.
// - No excluded picker types; Collections support every field type.
import type { BuilderConfig } from "@admin/components/features/schema-builder/builder-config";

export const COLLECTION_BUILDER_CONFIG: BuilderConfig = {
  kind: "collection",
  basicsFields: ["singularName", "pluralName", "slug", "description", "icon"],
  advancedFields: [
    "adminGroup",
    "order",
    "useAsTitle",
    "status",
    "i18n",
    "timestamps",
  ],
  toolbar: { showHooks: true, previewSchemaChange: true },
  picker: {},
};
