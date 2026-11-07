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
 * A collection created at runtime is served at the address its template
 * stores (`address`), set in the admin by someone allowed to change routing;
 * see `templates/template-routing`.
 *
 * @module collections/templates
 */
import { defineCollection, text, type CollectionConfig } from "nextly/config";

import { blocks } from "../fields/blocksHelper";
import {
  mayManageTemplateRouting,
  TEMPLATE_ADDRESS_FIELD,
} from "../templates/template-routing";

/** The slug templates are stored under, before any rename a host applies. */
export const TEMPLATES_SLUG = "templates";

/**
 * The field naming the collection a template renders. Unique, so a
 * collection has one template: read by the guard that names the template
 * already there, and by everything that finds a collection's template.
 */
export const TEMPLATE_COLLECTION_FIELD = "collection";

/** The blocks field holding the template's design. */
export const TEMPLATE_CONTENT_FIELD = "content";

/**
 * The control the template form draws the address with: editable by someone
 * allowed to change routing, read-only to anyone else.
 */
export const TEMPLATE_ADDRESS_FIELD_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#TemplateAddressField";

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
      text({
        name: TEMPLATE_ADDRESS_FIELD,
        label: "Address",
        // One collection per address on every dialect and under concurrent
        // writes; the guard names the collection holding one before the
        // database is asked. Many templates store none (null).
        unique: true,
        // Bounded on every write path, as the title is, to what the column
        // holds on every dialect.
        maxLength: 255,
        // Setting or changing it moves every entry's live address, so it is
        // its own permission, apart from updating templates: anyone else's
        // value is taken out of the write and the stored one kept.
        access: {
          create: mayManageTemplateRouting,
          update: mayManageTemplateRouting,
        },
        admin: {
          component: TEMPLATE_ADDRESS_FIELD_COMPONENT,
          placeholder: "/blog",
          description:
            "Where this collection's entries are served: with /blog, the entry hello is served at /blog/hello once the template is published. Changing it moves every entry to the new address and frees the old ones.",
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
      // Kept out of the Collections listing and offered from the page
      // builder's own menu instead, beside Patterns, Components and Layouts.
      hidden: true,
      // Which collection each template draws, and where its entries are
      // served.
      defaultColumns: [
        "title",
        TEMPLATE_COLLECTION_FIELD,
        TEMPLATE_ADDRESS_FIELD,
        "status",
      ],
    },
  });
}
