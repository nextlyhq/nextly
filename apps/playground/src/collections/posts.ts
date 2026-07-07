import { pageBuilderField } from "@nextlyhq/plugin-page-builder";
import {
  defineCollection,
  text,
  textarea,
  richText,
  date,
  upload,
  relationship,
  select,
  option,
} from "nextly/config";

// Demo Posts collection for the contributor playground. Exercises the
// most common field shapes (text, slug, rich-text, relationships,
// upload, date) so a contributor clicking around the admin sees
// those surfaces working without us having to register a plugin.
//
// `title` and `slug` are defined explicitly so they replace Nextly's
// auto-injected reserved columns. `id`, `createdAt`, `updatedAt` are
// always auto-injected — never declare them yourself. Draft/Published
// is wired via the built-in `status: true` flag (matches the blog
// template's post-#317 shape) instead of a user-defined select.
export const Posts = defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    text({ name: "title", required: true }),
    text({ name: "slug", required: true, unique: true }),
    textarea({ name: "excerpt" }),
    // Kept so `db:sync` stays additive-only (the dev DB already has these columns).
    text({ name: "metaTitle" }),
    text({ name: "metaDescription" }),
    // Editor choice (Elementor-style): pick how to author the body. The matching editor
    // field appears below; the front-end renders whichever was chosen.
    select({
      name: "editorMode",
      label: "Editor",
      defaultValue: "standard",
      options: [
        option("Standard editor", "standard"),
        option("Page Builder", "page-builder"),
      ],
      admin: { description: "Choose how to build this post's body." },
    }),
    // Standard editor — shown only in "standard" mode.
    richText({
      name: "content",
      admin: { condition: { field: "editorMode", equals: "standard" } },
    }),
    // Visual page builder — shown only in "page-builder" mode.
    pageBuilderField("layout", {
      label: "Visual Layout",
      condition: { field: "editorMode", equals: "page-builder" },
    }),
    relationship({
      name: "categories",
      relationTo: "categories",
      hasMany: true,
    }),
    relationship({
      name: "tags",
      relationTo: "tags",
      hasMany: true,
    }),
    upload({ name: "featuredImage", relationTo: "media" }),
    date({ name: "publishedAt" }),
  ],
  // Built-in Draft / Published lifecycle. Surfaces Save Draft / Publish
  // buttons in the entry editor and Bulk Publish / Unpublish actions in
  // the entry-table bulk-action bar.
  status: true,
  admin: {
    useAsTitle: "title",
  },
});
