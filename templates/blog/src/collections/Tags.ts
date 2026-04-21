/**
 * Tags collection: granular cross-cutting taxonomy. Flat (no hierarchy).
 * Lives alongside Categories: categories organize the blog's IA, tags
 * surface topic connections across categories.
 */
import { defineCollection, text, textarea } from "@revnixhq/nextly/config";

import { isAuthorOrEditor } from "@/access/is-author-or-editor";
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
  // Same policy as Categories: public read, content roles curate.
  access: {
    read: true,
    create: isAuthorOrEditor,
    update: isAuthorOrEditor,
    delete: isAuthorOrEditor,
  },
  hooks: { beforeValidate: [autoSlug] },
});
