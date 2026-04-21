/**
 * Tags collection: granular cross-cutting taxonomy. Flat (no hierarchy).
 * Lives alongside Categories: categories organize the blog's IA, tags
 * surface topic connections across categories.
 */
import { defineCollection, text, textarea } from "@revnixhq/nextly/config";

import { autoSlug } from "@/hooks/auto-slug";

export const Tags = defineCollection({
  slug: "tags",
  labels: { singular: "Tag", plural: "Tags" },
  fields: [
    text({ name: "name", required: true }),
    text({ name: "slug", required: true, unique: true }),
    textarea({ name: "description" }),
  ],
  admin: { useAsTitle: "name" },
  hooks: { beforeValidate: [autoSlug] },
});
