/**
 * Related links — an e2e fixture, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`.
 *
 * It exists for the browser test of a related item the editor cannot read: a
 * Single holding a relationship and an upload, so the test can show both kept
 * as placeholders on a Single as well as on an entry. No playground Single has
 * either field, and adding them to one would change what it is for in every
 * development run.
 */
import { defineSingle, relationship, text, upload } from "nextly/config";

export const RelatedLinks = defineSingle({
  slug: "related-links",
  label: { singular: "Related links" },
  fields: [
    text({ name: "headline", label: "Headline" }),
    relationship({
      name: "featuredTags",
      label: "Featured tags",
      relationTo: "tags",
      hasMany: true,
    }),
    upload({ name: "logo", label: "Logo", relationTo: "media" }),
  ],
});
