/**
 * Entry articles — an e2e fixture, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`.
 *
 * What a template's Entry content block draws, for the browser tests of it:
 * each article has two blocks fields of its own, so the block's Field menu
 * offers a choice, and is served at `/articles/<its slug>` with the
 * collection's template.
 *
 * `membersOnly` is a blocks field the public may not read: its read rule
 * answers only for a signed-in user, so a published page drawing it draws
 * nothing, for everyone, because a published page reads as a visitor.
 */
import { blocks } from "@nextlyhq/plugin-page-builder";
import { defineCollection, text } from "nextly/config";

export const EntryArticles = defineCollection({
  slug: "entry-articles",
  labels: { singular: "Article", plural: "Articles" },
  // A draft never reaches a published page.
  status: true,
  // The public reads the collection; the members' field is withheld by its
  // own rule.
  access: { read: () => true },
  fields: [
    text({ name: "title", label: "Title" }),
    text({ name: "slug", label: "Slug", unique: true }),
    blocks({ name: "body", label: "Body" }),
    blocks({
      name: "membersOnly",
      label: "Members only",
      access: { read: ({ user }) => user !== null },
    }),
  ],
});
