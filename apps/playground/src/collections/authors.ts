/**
 * Authors collection (code-first) — the code-first counterpart to the builder-created
 * collections, and a localized one so the code-first i18n path is exercised too.
 *
 * `localized: true` means text-like fields translate by default and live in the
 * companion `dc_authors_locales` table (one row per language), while non-text fields
 * stay shared on the main `dc_authors` table. `id`, `title`, `slug`, `createdAt`,
 * `updatedAt` are auto-injected — only user fields are declared here.
 */
import {
  defineCollection,
  textarea,
  text,
  number,
  upload,
} from "nextly/config";

export const Authors = defineCollection({
  slug: "authors",
  labels: { singular: "Author", plural: "Authors" },
  // Translatable content lives per-language in the companion table.
  localized: true,
  fields: [
    // Translatable (text-like → localized by default): stored per language.
    textarea({ name: "bio", label: "Biography" }),
    // NOTE: `role` is a SQL reserved keyword — use a non-reserved column name.
    text({ name: "jobTitle", label: "Role / Title" }),
    // Shared (not text-like → one value across all languages): stored on main.
    number({ name: "articleCount", label: "Article Count" }),
    upload({ name: "avatar", relationTo: "media", label: "Avatar" }),
  ],
  // Draft / Published lifecycle — the companion also gets a per-locale `_status`.
  status: true,
  // Pending changes, per language: editing a published translation holds the
  // edit for that language instead of publishing it. Enabled here because this
  // is the only playground collection that is BOTH localized and lifecycled, so
  // without it the per-language pending state has no surface to be seen on.
  versions: { drafts: true },
  admin: {
    useAsTitle: "title",
  },
});
