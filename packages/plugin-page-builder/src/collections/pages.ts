import { defineCollection, text, code } from "nextly/config";

import { blocks } from "../fields/blocksHelper";
import { CUSTOM_CSS_GRANT } from "../permissions";
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
 * The plugin-owned `pages` collection. A page is built from blocks.
 *
 * The FIELD decides how an entry is edited, and nothing decides it per entry.
 * This previously carried a stored `editorMode` select beside both a blocks
 * field and a rich-text one, either of which an entry could use.
 *
 * Three things were wrong with that, and only the first is cosmetic:
 *
 * A UI preference was stored as CONTENT. `editorMode` was a real column, so it
 * travelled in API responses and exports, could be set by any writer, and formed
 * part of the document a consumer reads.
 *
 * Both editors' content persisted at once. What hid one of them was
 * `admin.condition`, which reaches the admin form and nothing else, so both
 * columns stayed real and writable. An entry could hold a block document AND
 * rich text with only one rendered, and switching neither migrated nor warned.
 *
 * And it applied HERE only. A collection built in the schema builder gets a
 * blocks field and no switcher, so one capability behaved differently depending
 * on who declared the collection.
 */
export function pagesCollection() {
  return defineCollection({
    slug: "pages",
    labels: { singular: "Page", plural: "Pages" },
    fields: [
      text({ name: "title", required: true }),
      text({ name: "slug", required: true, unique: true }),
      // Named `content` because that is what the retired choice called its
      // builder arm: a page already holding a block document keeps rendering
      // rather than reading as empty against a field with a new name.
      blocks({ name: "content", label: "Page Builder" }),
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
