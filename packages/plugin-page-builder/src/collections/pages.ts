import { defineCollection, previewUrlFromTemplate, text } from "nextly/config";

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
/**
 * Where a page is served on the site — declared only when the host says so.
 *
 * A default was the obvious choice and it is the wrong one, because minting a
 * preview link now REFUSES when a collection declares no preview URL. Those two
 * behaviours interact: without a declaration an editor is told, in words, that a
 * developer needs to configure one; with a defaulted declaration the mint
 * succeeds and the reviewer gets a 404 that looks like an expired link.
 *
 * So a default would make an existing installation — one that upgrades while
 * still calling `pageBuilder()` and has mounted no preview route — strictly
 * worse off than declaring nothing, by replacing an explanation with a silent
 * failure. The plugin cannot install the host's route or its draft gate, and it
 * cannot discover where pages are mounted: a host may serve them at `/`, at
 * `/blocks`, or under a locale segment.
 *
 * Passing `pagePreviewPath` is therefore how a host states that it has done the
 * wiring. It costs one line and it is the only signal available that the link
 * will land.
 */
export function pagesCollection(previewPath?: string) {
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
    admin: {
      useAsTitle: "title",
      // Present only when the host supplied a path. A code-first collection
      // declares a FUNCTION — `urlTemplate` is the spelling a UI-created
      // collection stores, since no column can hold a function — and the path is
      // turned into one through the shared helper rather than a substitution
      // written here, so a template and a function cannot resolve the same entry
      // to two different addresses.
      ...(previewPath === undefined
        ? {}
        : { preview: { url: previewUrlFromTemplate(previewPath) } }),
    },
  });
}
