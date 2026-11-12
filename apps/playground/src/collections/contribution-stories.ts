/**
 * Contribution stories — an e2e fixture, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`.
 *
 * The one collection whose edit page the contributions fixture changes: its
 * replacement takes the built-in `editor` block's place here, and only here.
 * The fixture is always registered, so a replacement scoped to a collection
 * every run has would change a page contributors and other tests use.
 */
import { defineCollection, text } from "nextly/config";

export const ContributionStories = defineCollection({
  slug: "contribution-stories",
  labels: { singular: "Contribution story", plural: "Contribution stories" },
  fields: [
    text({ name: "title", label: "Title" }),
    text({ name: "summary", label: "Summary" }),
  ],
});
