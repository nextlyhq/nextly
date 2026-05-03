// Why: single config object drives the shared schema-builder components for all
// three kinds (collection / single / component). Each builder page constructs
// its own config and passes it down — shared components never branch on `kind`.

import type { FieldPrimitiveType } from "@admin/types/collection";

export type BuilderKind = "collection" | "single" | "component";

export type BasicsField =
  | "singularName"
  | "pluralName"
  | "slug"
  | "description"
  | "icon";

export type AdvancedField =
  | "adminGroup"
  | "category"
  | "order"
  | "status"
  | "i18n"
  | "showSystemFields";

export type BuilderConfig = {
  kind: BuilderKind;
  /** Which Basics-tab rows to render in BuilderSettingsModal. */
  basicsFields: readonly BasicsField[];
  /** Which Advanced-tab rows to render in BuilderSettingsModal. */
  advancedFields: readonly AdvancedField[];
  toolbar: {
    /** Show the Hooks button in BuilderToolbar (Collections + Singles only). */
    showHooks: boolean;
    /** Run schema-change preview before save (Collections only — Singles and
     * Components apply the mutation directly per the per-kind audit). */
    previewSchemaChange: boolean;
  };
  picker: {
    /** Field types to omit from FieldPickerModal. Empty for all kinds today
     * per audit findings; reserved for future product decisions. */
    excludedTypes?: readonly FieldPrimitiveType[];
  };
};
