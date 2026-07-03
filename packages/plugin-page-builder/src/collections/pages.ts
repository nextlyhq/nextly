import {
  defineCollection,
  text,
  richText,
  code,
  select,
  option,
} from "nextly/config";

import { pageBuilderField } from "./pageBuilderField";

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
      // The editor choice, shown on every page.
      select({
        name: "editorMode",
        label: "Editor",
        defaultValue: "builder",
        options: [
          option("Page Builder", "builder"),
          option("Normal editor", "normal"),
        ],
        admin: { description: "Choose how to edit this page." },
      }),
      // Page Builder — the visual block tree (reuses the existing `content` column).
      pageBuilderField("content", {
        label: "Page Builder",
        condition: { field: "editorMode", equals: "builder" },
      }),
      // Normal editor — Nextly's default rich-text form.
      richText({
        name: "body",
        label: "Content",
        admin: { condition: { field: "editorMode", equals: "normal" } },
      }),
      code({ name: "customCss", admin: { language: "css" } }),
    ],
    status: true,
    admin: { useAsTitle: "title" },
  });
}
