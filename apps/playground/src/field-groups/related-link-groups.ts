/**
 * Link card and link quote — e2e fixtures, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`, with the Single and the collection that embed
 * them.
 *
 * They exist for the browser test of a related item the editor cannot read,
 * inside a field group: a card holds a to-many relationship and an upload, a
 * quote a to-one relationship, and `relatedLinkGroupFields` embeds a card on
 * its own and a dynamic zone of both. No playground field group holds either
 * kind of link, and adding one would change what it is for in every
 * development run.
 */
import {
  defineFieldGroup,
  fieldGroup,
  relationship,
  text,
  upload,
} from "nextly/config";

export const LinkCard = defineFieldGroup({
  slug: "link-card",
  label: { singular: "Link card" },
  fields: [
    text({ name: "heading", label: "Heading" }),
    relationship({
      name: "cardTags",
      label: "Card tags",
      relationTo: "tags",
      hasMany: true,
    }),
    upload({ name: "cardImage", label: "Card image", relationTo: "media" }),
  ],
});

export const LinkQuote = defineFieldGroup({
  slug: "link-quote",
  label: { singular: "Link quote" },
  fields: [
    relationship({ name: "quoteTag", label: "Quote tag", relationTo: "tags" }),
  ],
});

/** A link card on its own, and a dynamic zone of cards and quotes. */
export const relatedLinkGroupFields = () => [
  fieldGroup({ name: "card", label: "Card", component: "link-card" }),
  fieldGroup({
    name: "blocks",
    label: "Blocks",
    components: ["link-card", "link-quote"],
    repeatable: true,
  }),
];
