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

/** The slug templates are stored under, before any rename a host applies. */
export const TEMPLATES_SLUG = "templates";

/**
 * The field naming the collection a template renders. Read by the guard that
 * keeps one template per collection, and by everything that finds a
 * collection's template.
 */
export const TEMPLATE_COLLECTION_FIELD = "collection";

/**
 * The field holding the template's place among templates: one unique value
 * per place, so the database itself refuses a second template in it.
 */
export const TEMPLATE_SLOT_FIELD = "slotKey";

/** The blocks field holding the template's design. */
export const TEMPLATE_CONTENT_FIELD = "content";

export function templatesCollection(): CollectionConfig {
  return defineCollection({
    slug: TEMPLATES_SLUG,
    labels: { singular: "Template", plural: "Templates" },
    fields: [
      text({ name: "title", required: true }),
      text({
        name: TEMPLATE_COLLECTION_FIELD,
        label: "Collection",
        required: true,
        admin: {
          description:
            "The collection whose entries this template draws. It cannot be changed once the template exists.",
        },
      }),
      // Written by the plugin on create, never by a person: the place this
      // template holds, `base:<collection>` for a collection's template. The
      // unique index on it is the guard that holds under concurrent writes,
      // on every dialect, whichever path the write takes; the hook that sets
      // it only names the template already there. It carries no field access
      // rule, since a promotion of a working draft re-judges every field's
      // write access and would put a denied value back.
      text({
        name: TEMPLATE_SLOT_FIELD,
        label: "Slot",
        unique: true,
        admin: { hidden: true },
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
