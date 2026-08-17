import { defineCollection, text, code } from "nextly/config";

import { CUSTOM_CSS_GRANT } from "../permissions";

import { editorChoiceFields } from "./editorChoice";
/**
 * Sibling field for page-level custom CSS. When the host entity has a field
 * with this name, the builder's page settings edit it.
 *
 * Declared here rather than imported because this collection is now its only
 * reader. It previously sat beside the removed editor's field constants, where
 * it was one of a set describing that editor's entry shape; the rest of that set
 * described a document format nothing reads any more.
 */
export const PAGE_BUILDER_CUSTOM_CSS_FIELD = "customCss";

/**
 * There is no builder Edit-view path any more.
 *
 * This named a full-screen edit view a host could register for a builder-only
 * collection. The view is gone with the editor that backed it, and the constant
 * went with it rather than being kept pointing at a component nothing exports —
 * a registry path is a STRING, so an unresolvable one fails at render time in
 * the admin rather than at build time here.
 */

/**
 * The plugin-owned `pages` collection. Each page CHOOSES its editor (Elementor-style):
 *  - "Page Builder" → the visual block tree (`content`, a `blocks` field).
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
      code({
        name: PAGE_BUILDER_CUSTOM_CSS_FIELD,
        admin: { language: "css" },
        // Writing custom CSS is gated; reading it is not. A user who may edit
        // the page still needs to SEE the CSS already on it — the editor shows
        // it, and hiding it would make the field look empty and invite it being
        // overwritten with nothing. Withholding the grant makes it read-only,
        // which is the intended shape of the privilege.
        //
        // A denied field is stripped from the write silently rather than
        // rejected, so a user without the grant saves the rest of the page
        // normally and the stored CSS is left as it was.
        access: {
          create: ({ permissions }) => permissions.includes(CUSTOM_CSS_GRANT),
          update: ({ permissions }) => permissions.includes(CUSTOM_CSS_GRANT),
        },
      }),
    ],
    status: true,
    admin: { useAsTitle: "title" },
  });
}
