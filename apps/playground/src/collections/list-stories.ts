/**
 * List stories — an e2e fixture, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`.
 *
 * What a collection list's related source needs to be shown: an entry the
 * public reads, built in the Page Builder, holding a to-many relation the
 * public reads too. A list on a story can then show "This story's featured
 * entries", and a list of stories can hold a list of each story's. No other
 * playground collection is all three, and making one so would change what it
 * is for in every development run.
 */
import { blocks } from "@nextlyhq/plugin-page-builder";
import { defineCollection, relationship, text } from "nextly/config";

export const ListStories = defineCollection({
  slug: "list-stories",
  labels: { singular: "Story", plural: "Stories" },
  // A draft row must never reach a published page.
  status: true,
  // The public reads stories and the entries they feature, as a page's list
  // does.
  access: { read: () => true },
  fields: [
    text({ name: "title", label: "Title" }),
    relationship({
      name: "featured",
      label: "Featured entries",
      relationTo: "bound-entries",
      hasMany: true,
    }),
    blocks({ name: "content", label: "Content" }),
  ],
});
