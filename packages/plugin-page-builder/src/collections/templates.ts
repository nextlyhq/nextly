/**
 * The plugin-owned `templates` collection: the designs a collection's entries
 * are drawn with.
 *
 * A template is a builder document of kind `template`, stored as an entry like
 * a page, so it has drafts, publishing, history, the soft lock and recovery
 * without any of them being written again. Each names the collection whose
 * entries it renders, by slug. A collection created at runtime in the Schema
 * Builder reaches one the same way a collection declared in code does, which
 * a template declared in a collection's code configuration could not.
 *
 * @module collections/templates
 */
import { defineCollection, text, type CollectionConfig } from "nextly/config";

import { blocks } from "../fields/blocksHelper";
import { TEMPLATE_COLLECTION_FIELD } from "../templates/template-preview-contract";

/** The slug templates are stored under, before any rename a host applies. */
export const TEMPLATES_SLUG = "templates";

/**
 * The field naming the collection a template renders, declared in the
 * preview contract so the editor's bundle reads the same name without this
 * module's runtime imports, and re-exported here beside the collection.
 */
export { TEMPLATE_COLLECTION_FIELD };

/** The blocks field holding the template's design. */
export const TEMPLATE_CONTENT_FIELD = "content";

export function templatesCollection(): CollectionConfig {
  return defineCollection({
    slug: TEMPLATES_SLUG,
    labels: { singular: "Template", plural: "Templates" },
    fields: [
      // Bounded on every write path, so a long title is refused alike on every
      // dialect rather than fitting one database's column and not another's.
      text({ name: "title", required: true, maxLength: 255 }),
      text({
        name: TEMPLATE_COLLECTION_FIELD,
        label: "Collection",
        required: true,
        // The guard that holds under concurrent writes, on every dialect,
        // whichever path the write takes and whatever a hook does after the
        // plugin's: the database refuses a second template for a collection.
        unique: true,
        admin: {
          description:
            "The collection whose entries this template draws. A collection has one template, and it cannot be changed once the template exists.",
        },
      }),
      blocks({
        name: TEMPLATE_CONTENT_FIELD,
        label: "Template",
        blocks: { kinds: ["template"] },
      }),
    ],
    status: true,
    // A published template is what an entry's public page is drawn with, so
    // anyone may read one, as anyone may read a page. A visitor's read is held
    // to published content whatever it asks for, so a draft template stays
    // unseen.
    access: { read: () => true },
    // A save keeps a working draft and publishing is its own act, as for
    // pages: editing a live template changes every entry's page, and that
    // should happen when the author publishes, not on each save.
    versions: { drafts: true },
    admin: {
      useAsTitle: "title",
      // Not offered in the admin's navigation until it has screens of its
      // own; the builder and the API reach it meanwhile.
      hidden: true,
    },
  });
}
