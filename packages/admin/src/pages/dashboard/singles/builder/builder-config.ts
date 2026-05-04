// Why: page-local config that drives the new shared schema-builder
// components for the Single builder. Per the per-kind audit:
// - Singles have NO plural (singletons by definition).
// - Singles HAVE slug (used for the public route).
// - Advanced has Admin group + Order + Status + i18n placeholder. NO
//   useAsTitle (only one row), NO timestamps (Singles have updatedAt
//   only, managed automatically), NO Category.
// - Hooks button visible (Singles support hooks).
// - Schema-change preview disabled per audit — Singles update via the
//   direct mutation path; the new BuilderToolbar's Save schema button
//   triggers saveSettings directly.
// - No excluded picker types.
import type { BuilderConfig } from "@admin/components/features/schema-builder/builder-config";

export const SINGLE_BUILDER_CONFIG: BuilderConfig = {
  kind: "single",
  basicsFields: ["singularName", "slug", "description", "icon"],
  // showSystemFields added in PR B so singles can also surface the toggle.
  advancedFields: ["adminGroup", "order", "status", "i18n", "showSystemFields"],
  toolbar: { previewSchemaChange: false },
  picker: {},
};
