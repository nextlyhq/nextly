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
  // Why: Hooks UI removed in PR D per feedback Section 2; code-first hooks
  // in nextly.config.ts continue to work, but the toolbar button and
  // HooksEditorSheet are gone. The HooksEditor component remains in the
  // codebase until PR F deletes it.
  toolbar: {
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
