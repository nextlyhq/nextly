/**
 * The plugin-owned `templates` collection: the designs a collection's entries
 * are drawn with, and the own designs single entries are drawn with instead.
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

/**
 * The fields of an entry's own design: a template that serves one entry
 * rather than its collection, forked from the collection's template. Its
 * `collection` is empty, so everything that finds a collection's template
 * by that field finds the base template and never an own design.
 *
 * `entry` is the key of the entry it serves (see {@link entryDesignKey}),
 * unique, so an entry has one own design whatever writes race for it.
 * `entryCollection` and `entryId` name the entry plainly, the first indexed
 * so a collection's own designs are one query. `forkedFrom` is the base
 * template it was copied from, emptied when that template is deleted.
 */
export const TEMPLATE_ENTRY_FIELD = "entry";
export const TEMPLATE_ENTRY_COLLECTION_FIELD = "entryCollection";
export const TEMPLATE_ENTRY_ID_FIELD = "entryId";
export const TEMPLATE_FORKED_FROM_FIELD = "forkedFrom";

/**
 * The key an entry's own design is held under: its collection and id, each
 * encoded, so no collection and id pair spells another's.
 */
export function entryDesignKey(collection: string, id: string): string {
  return `${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
}

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
        // Not required of the field, since an entry's own design leaves it
        // empty (stored as no value, which the unique index lets many rows
        // share); the guard requires it of every base template.
        // The guard that holds under concurrent writes, on every dialect,
        // whichever path the write takes and whatever a hook does after the
        // plugin's: the database refuses a second template for a collection.
        unique: true,
        admin: {
          description:
            "The collection whose entries this template draws. A collection has one template, and it cannot be changed once the template exists.",
        },
      }),
      text({
        name: TEMPLATE_ENTRY_FIELD,
        label: "Entry",
        // One own design per entry, held by the database on every dialect,
        // whichever path the write takes.
        unique: true,
        admin: {
          description:
            "The entry this design serves, when it is an entry's own design rather than its collection's template. Set when it is made, and never changed.",
        },
      }),
      text({
        name: TEMPLATE_ENTRY_COLLECTION_FIELD,
        label: "Entry's collection",
        index: true,
      }),
      text({ name: TEMPLATE_ENTRY_ID_FIELD, label: "Entry id" }),
      // Indexed: deleting a template finds the designs copied from it by it.
      text({
        name: TEMPLATE_FORKED_FROM_FIELD,
        label: "Copied from",
        index: true,
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
