/**
 * Translator notes — an e2e fixture, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`.
 *
 * It exists for the browser test of a document a user may change in one
 * language and only read in another: its rule refuses an update in Spanish,
 * so a role holding read and update on it edits the English and opens the
 * Spanish read-only. No other playground collection has a rule that answers
 * by language, and adding one there would change what it is for in every
 * development run.
 */
import { defineCollection, text, textarea } from "nextly/config";

export const TranslatorNotes = defineCollection({
  slug: "translator-notes",
  labels: { singular: "Translator note", plural: "Translator notes" },
  localized: true,
  access: {
    update: ({ locale }) => locale !== "es",
  },
  fields: [
    text({ name: "title", label: "Title", required: true }),
    textarea({ name: "note", label: "Note" }),
  ],
});
