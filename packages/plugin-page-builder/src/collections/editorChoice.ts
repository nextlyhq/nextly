import { option, richText, select } from "nextly/config";

import { pageBuilderField } from "./pageBuilderField";

/**
 * A drop-in "choose your editor" field set (Elementor/WordPress-style). Spread it into
 * ANY code-first collection to give each entry a choice between the visual Page Builder
 * and Nextly's normal rich-text editor — the front-end renders whichever was chosen:
 *
 * ```ts
 * defineCollection({
 *   slug: "landing-pages",
 *   fields: [text({ name: "title" }), text({ name: "slug" }), ...editorChoiceFields()],
 * });
 * ```
 *
 * On the front-end: `entry.editorMode === "builder"` → render `entry[builderField]` via
 * `<PageRenderer>`; otherwise render `entry[normalField]` (rich text, fetched with
 * `richTextFormat: "html"`).
 *
 * Note: this is for CODE-FIRST collections. Collections built in the admin schema-builder
 * UI can't add these fields yet (that needs a UI-registered field type — a future door).
 */
export interface EditorChoiceOptions {
  /** Field name for the block tree (Page Builder mode). Default "content". */
  builderField?: string;
  /** Field name for the rich-text body (Normal mode). Default "body". */
  normalField?: string;
  /** Which editor is selected by default. Default "builder". */
  defaultMode?: "builder" | "normal";
}

export function editorChoiceFields(opts: EditorChoiceOptions = {}) {
  const builderField = opts.builderField ?? "content";
  const normalField = opts.normalField ?? "body";
  const defaultMode = opts.defaultMode ?? "builder";

  return [
    select({
      name: "editorMode",
      label: "Editor",
      defaultValue: defaultMode,
      options: [
        option("Page Builder", "builder"),
        option("Normal editor", "normal"),
      ],
      admin: { description: "Choose how to edit this entry." },
    }),
    pageBuilderField(builderField, {
      label: "Page Builder",
      condition: { field: "editorMode", equals: "builder" },
    }),
    richText({
      name: normalField,
      label: "Content",
      admin: { condition: { field: "editorMode", equals: "normal" } },
    }),
  ];
}
