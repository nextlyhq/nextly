// Why: page-local config that drives the shared schema-builder components
// for the Collection builder. useAsTitle is dropped (the system title is
// always the display) and timestamps are always emitted; showSystemFields is
// a UI pref toggle. The rest: Hooks button visible, schema-change preview on
// save, all Advanced tab; code-first config can still set admin.group /
// admin.order.
import type { BuilderConfig } from "@admin/components/features/schema-builder/builder-config";

export const COLLECTION_BUILDER_CONFIG: BuilderConfig = {
  kind: "collection",
  basicsFields: [
    "singularName",
    "pluralName",
    "slug",
    "description",
    "icon",
    "startingField",
  ],
  advancedFields: [
    "status",
    "i18n",
    "versions",
    "revalidate",
    // Webhook recording. On by default; an explicit opt-out keeps this
    // collection's writes out of the outbox and every delivery, which is what
    // content holding personal data needs. Lives in Advanced next to the other
    // per-entity policy switches.
    "webhooks",
    "showSystemFields",
  ],
  toolbar: { previewSchemaChange: true },
  picker: {},
};
