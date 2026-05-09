import { defineCollection, text, textarea } from "nextly/config";

// Demo Categories collection for the contributor playground. Trivial
// taxonomy used to exercise relationship pickers from Posts.
//
// `title` and `slug` are defined explicitly so they replace Nextly's
// auto-injected reserved columns of the same name (see
// packages/nextly/src/domains/schema/services/field-column-descriptor.ts).
// `id`, `createdAt`, and `updatedAt` are always auto-injected — never
// declare them yourself.
export const Categories = defineCollection({
  slug: "categories",
  labels: { singular: "Category", plural: "Categories" },
  fields: [
    text({ name: "title", required: true }),
    text({ name: "slug", required: true, unique: true }),
    textarea({ name: "description" }),
  ],
});
