// Why: page-local config that drives the shared schema-builder components
// for the Collection builder. PR B (2026-05-03) dropped useAsTitle (system
// title is always the display) and timestamps (always emitted), and added
// showSystemFields (UI pref toggle). Per-kind audit
// (docs/superpowers/findings/2026-05-02-builder-per-kind-audit.md) covers
// the rest: Hooks button visible, schema-change preview on save, all
// picker types available.
import type { BuilderConfig } from "@admin/components/features/schema-builder/builder-config";

export const COLLECTION_BUILDER_CONFIG: BuilderConfig = {
  kind: "collection",
  basicsFields: ["singularName", "pluralName", "slug", "description", "icon"],
  advancedFields: ["adminGroup", "order", "status", "i18n", "showSystemFields"],
  toolbar: { previewSchemaChange: true },
  picker: {},
};
