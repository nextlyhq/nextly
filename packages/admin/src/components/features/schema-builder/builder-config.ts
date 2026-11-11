// Why: single config object drives the shared schema-builder components for all
// three kinds (collection / single / component). Each builder page constructs
// its own config and passes it down — shared components never branch on `kind`.

import type { FieldTypeId } from "@admin/types/collection";

export type BuilderKind = "collection" | "single" | "field-group";

/**
 * How each kind is named in a sentence, e.g. "This Single has no custom fields
 * yet." The kind is a slug, so it cannot be interpolated as it is ("This
 * field-group ..."). "Single" keeps its capital as the product's name for that
 * kind. Field groups are called components in code, and that word is never
 * shown. Every builder message that names the kind reads it from here, so the
 * three kinds are spelled the same way on every screen.
 */
export const BUILDER_KIND_NOUN: Record<BuilderKind, string> = {
  collection: "collection",
  single: "Single",
  "field-group": "field group",
};

export type BasicsField =
  | "singularName"
  | "pluralName"
  | "slug"
  | "description"
  | "icon"
  /**
   * Which field a NEW entity starts with. Renders only in create mode, and only
   * when a plugin contributes something to choose between — a control with one
   * answer is worse than no control.
   */
  | "startingField";

// tab. Server-side `admin.group` / `admin.order` still work for code-first
// users; only the in-builder UI affordance is gone.
export type AdvancedField =
  | "category"
  | "status"
  | "i18n"
  | "versions"
  | "revalidate"
  | "webhooks"
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
    /** Field types to omit from the field picker. Empty for all kinds today
     * per audit findings; reserved for future product decisions. */
    excludedTypes?: readonly FieldTypeId[];
  };
};

/**
 * The types the picker leaves out: the kind's own exclusions, wherever the new field goes. A field
 * group's own fields hold a field group directly as well as inside a group or repeater: its
 * instances are rows of their own, under the instance holding them.
 */
export function pickerExcludedTypes(
  config: BuilderConfig
): readonly FieldTypeId[] {
  return config.picker.excludedTypes ?? [];
}
