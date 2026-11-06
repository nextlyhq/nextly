/**
 * Bound entries — an e2e fixture, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`.
 *
 * What a published page's bindings read, for the browser test of bindings
 * served to the public: a list of these is bound field by field, so the test
 * can check what a visitor is shown, and what they are not.
 *
 * `internalNote` is a field the public may not read: its read rule answers
 * only for a signed-in user, so a page bound to it shows its fallback to
 * everyone, signed in or not, because a published page reads as a visitor.
 */
import {
  date,
  defineCollection,
  number,
  relationship,
  text,
} from "nextly/config";

export const BoundEntries = defineCollection({
  slug: "bound-entries",
  // Named as a site would name such a collection, so the editor's lists of
  // it read as they would on a real site; "Posts" is the playground's own.
  labels: { singular: "Blog post", plural: "Blog posts" },
  // A draft row must never reach a published page.
  status: true,
  // The public reads this collection, as a page's list does; the protected
  // field below is withheld by its own rule.
  access: { read: () => true },
  fields: [
    text({ name: "title", label: "Title" }),
    text({
      name: "internalNote",
      label: "Internal note",
      access: { read: ({ user }) => user !== null },
    }),
    // A date picked as a day, so a bound format keeps its day in every zone.
    date({ name: "publishedAt", label: "Published" }),
    number({ name: "price", label: "Price" }),
    relationship({ name: "relatedPage", relationTo: "block-pages" }),
  ],
});
