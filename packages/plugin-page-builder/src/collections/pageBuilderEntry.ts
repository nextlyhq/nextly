import { option, select } from "nextly/config";

import { FIELD_COMPONENT_PATH, pageBuilderField } from "./pageBuilderField";

/** Reserved system field holding the BlockDocument JSON (spec §2). */
export const PAGE_BUILDER_CONTENT_FIELD = "content";
/** Per-entry editor-choice select field. All-lowercase so it survives the schema builder's
 *  field-name normalization (which lowercases), identical to the code-first name. */
export const EDITOR_MODE_FIELD = "editormode";
/** Plugin-registered field type id (spec §4.1). */
export const PAGE_BUILDER_TYPE = "page-builder";

export type EditorMode = "default" | "builder";

/**
 * @deprecated The editor-choice is now signalled purely by the presence of the
 * `page-builder` field (a `layout: "takeover"` field type) — no collection-level
 * flag is read anymore. Retained only for back-compat of existing type imports.
 */
export interface PageBuilderAdminConfig {
  enabled?: boolean;
  defaultMode?: EditorMode;
}

/**
 * Field-type descriptor registered via the plugin's `contributes.fieldTypes`.
 * `layout: "takeover"` tells the admin entry form to show only this field (plus
 * its editor-mode controller) when the field is visible — hiding the rest.
 */
export const PAGE_BUILDER_FIELD_TYPE = {
  type: PAGE_BUILDER_TYPE,
  storage: "json",
  component: FIELD_COMPONENT_PATH,
  layout: "takeover",
} as const;

/**
 * The two fields an entity needs to offer the Default / Page Builder choice: an `editorMode`
 * select and the reserved `content` page-builder field (shown only in builder mode). The
 * entity's OWN fields serve as the "Default" editor; the admin hides the non-essential ones
 * in builder mode (a later stage). Works in both `defineCollection` and `defineSingle`.
 */
export function pageBuilderFields(opts: { defaultMode?: EditorMode } = {}) {
  const defaultMode: EditorMode = opts.defaultMode ?? "default";
  return [
    select({
      // All-lowercase so the name is identical for code-first AND UI-created collections
      // (the schema builder lowercases field names); keeps the condition/detection stable.
      name: EDITOR_MODE_FIELD,
      label: "Editor",
      defaultValue: defaultMode,
      options: [
        option("Default", "default"),
        option("Page Builder", "builder"),
      ],
      // Hidden field: it stores the per-entry mode but never renders as a field.
      // The choice is surfaced as a toolbar toggle (contributes.admin
      // .entryFormToolbarSlot) and it's kept out of the schema-builder field list.
      admin: { hidden: true, description: "Choose how to edit this entry." },
    }),
    pageBuilderField(PAGE_BUILDER_CONTENT_FIELD, {
      label: "Page Builder",
      condition: { field: EDITOR_MODE_FIELD, equals: "builder" },
    }),
  ];
}

/**
 * Opt a CODE-FIRST collection/single config into the Page Builder editor choice:
 * appends `pageBuilderFields()`. The presence of the `page-builder` field is the
 * signal — no collection-level flag needed. Wrap the config passed to
 * `defineCollection`/`defineSingle`:
 *
 * ```ts
 * defineCollection(withPageBuilder({ slug: "landing", fields: [text({ name: "title" })] }));
 * ```
 */
export function withPageBuilder<T extends { fields?: unknown[] }>(
  config: T,
  opts: { defaultMode?: EditorMode } = {}
): T {
  const defaultMode: EditorMode = opts.defaultMode ?? "default";
  return {
    ...config,
    fields: [...(config.fields ?? []), ...pageBuilderFields({ defaultMode })],
  };
}
