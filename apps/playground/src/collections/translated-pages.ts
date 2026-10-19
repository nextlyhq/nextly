/**
 * Translated pages — an e2e fixture, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`.
 *
 * It exists for the Page Builder's default-language browser test: a localized
 * collection whose blocks field is itself translated, so the test can show the
 * builder opens, previews and saves the default language and leaves another
 * language's layout as it was. No other playground collection is both localized
 * and page-built, and making one of them so would change what it is for in
 * every development run.
 */
import { blocks } from "@nextlyhq/plugin-page-builder";
import { defineCollection, text } from "nextly/config";

export const TranslatedPages = defineCollection({
  slug: "translated-pages",
  labels: { singular: "Translated page", plural: "Translated pages" },
  localized: true,
  fields: [
    text({ name: "title", label: "Title" }),
    blocks({ name: "layout", label: "Layout", localized: true }),
  ],
});
