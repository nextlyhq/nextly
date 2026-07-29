// Page-local builder config for field groups. Their Basics tab collects a name
// (labelled "Singular name", though the user is naming the field group itself),
// description and icon; the slug is derived from the name and identifies the
// field group. Advanced offers Category, which groups field groups in the admin
// the way adminGroup groups collections, plus i18n. Order, useAsTitle, Status
// and Timestamps do not apply: a field group is a reusable building block
// rather than a record. Hooks are unsupported, and schema-change preview is off
// because a field group owns no rows of its own, so mutations apply directly.
import type { BuilderConfig } from "@admin/components/features/schema-builder/builder-config";

export const FIELD_GROUP_BUILDER_CONFIG: BuilderConfig = {
  kind: "field-group",
  basicsFields: ["singularName", "slug", "description", "icon"],
  // Field-group schemas surface the system-field toggle like the other kinds.
  advancedFields: ["category", "i18n", "showSystemFields"],
  toolbar: { previewSchemaChange: false },
  picker: {},
};
