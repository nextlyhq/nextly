import { defineCollection, text, textarea } from "nextly/config";

// Demo Tags collection for the contributor playground. Granular
// cross-cutting topics; pairs with Categories on Posts.
//
// `title` and `slug` are defined explicitly so they replace Nextly's
// auto-injected reserved columns of the same name. `id`, `createdAt`,
// `updatedAt` are always auto-injected — never declare them yourself.
export const Tags = defineCollection({
  slug: "tags",
  labels: { singular: "Tag", plural: "Tags" },
  fields: [
    text({ name: "title", required: true }),
    text({ name: "slug", required: true, unique: true }),
    textarea({ name: "description" }),
  ],
});
