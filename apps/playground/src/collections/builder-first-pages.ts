/**
 * Builder-first pages — an e2e fixture, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`.
 *
 * It exists for the browser tests of where an entry opens: a collection laid
 * out as Posts are (a blocks field after an excerpt, so by its main field it
 * would open as a form) that says its entries open in the Page Builder. Every
 * link to one of its entries then opens the builder, except for a reader who
 * may not update it and for an entry opened in a language other than the
 * default, and the form keeps its own address. Localized, so the language
 * case has a second language to open; with drafts, so its saves reach the
 * dashboard's Continue card. No other playground collection says where its
 * entries open, and making one of them do so would change what every
 * development run opens.
 */
import { blocks } from "@nextlyhq/plugin-page-builder";
import { defineCollection, text, textarea } from "nextly/config";

export const BuilderFirstPages = defineCollection({
  slug: "builder-first-pages",
  labels: { singular: "Builder-first page", plural: "Builder-first pages" },
  localized: true,
  status: true,
  admin: { opensIn: "builder" },
  fields: [
    text({ name: "title", label: "Title", required: true, localized: true }),
    textarea({ name: "excerpt", label: "Excerpt", localized: true }),
    blocks({ name: "sections", label: "Sections" }),
  ],
});
