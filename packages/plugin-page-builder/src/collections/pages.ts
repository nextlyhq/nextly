import { defineCollection, text, code } from "nextly/config";

import { editorChoiceFields } from "./editorChoice";

/**
 * Registry path of the full-screen builder Edit view — still exported (and registered)
 * for hosts that want a builder-only collection. The default `pages` collection below
 * instead offers a per-entry CHOICE between the normal Nextly editor and the builder.
 */
export const EDIT_VIEW_PATH =
  "@nextlyhq/plugin-page-builder/admin#PageBuilderEditView";

/**
 * The plugin-owned `pages` collection. Each page CHOOSES its editor (Elementor-style):
 *  - "Page Builder" → the visual block tree (`content`, a `pageBuilderField`).
 *  - "Normal editor" → Nextly's default rich-text form (`body`).
 * The front-end renders whichever was chosen. Using field conditions (not an Edit-view
 * override) keeps the normal editor available — a single Edit view can't offer both.
 */
export function pagesCollection() {
  return defineCollection({
    slug: "pages",
    labels: { singular: "Page", plural: "Pages" },
    fields: [
      text({ name: "title", required: true }),
      text({ name: "slug", required: true, unique: true }),
      // The Elementor-style editor choice (select + Page Builder + normal rich text).
      ...editorChoiceFields(),
      code({ name: "customCss", admin: { language: "css" } }),
    ],
    status: true,
    admin: { useAsTitle: "title" },
  });
}
