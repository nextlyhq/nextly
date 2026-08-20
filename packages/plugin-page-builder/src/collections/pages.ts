import { defineCollection, text } from "nextly/config";

import { blocks } from "../fields/blocksHelper";
/**
 * There is no page-level custom CSS field.
 *
 * One existed, gated by its own permission, and nothing ever rendered what it
 * stored: no renderer read the value and nothing sanitised it. A permission
 * around a field implies its safety was considered, so the next change to add
 * the missing render call would have had every reason to assume the text was
 * already clean. Removing the field removes that implication along with it.
 *
 * Reinstating it means writing the sanitiser first — a stylesheet needs its
 * selectors scoped and its properties allow-listed, which is a different job
 * from the value-level checks the rich-text path performs.
 */

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
    ],
    status: true,
    admin: { useAsTitle: "title" },
  });
}
