/**
 * Categories collection: simple taxonomy for organizing posts.
 * Trivial shape (3 fields, one shared hook) so it lives as a single file
 * alongside Posts/ rather than a folder.
 */
import { defineCollection, text, textarea } from "@revnixhq/nextly/config";

import { isAuthorOrEditor } from "@/access/is-author-or-editor";
import { autoSlug } from "@/hooks/auto-slug";

export const Categories = defineCollection({
  slug: "categories",
  labels: { singular: "Category", plural: "Categories" },
  fields: [
    text({ name: "name", required: true }),
    text({ name: "slug", required: true, unique: true }),
    textarea({ name: "description" }),
  ],
  admin: { useAsTitle: "name" },
  // Public can read categories; content roles can curate them.
  access: {
    read: true,
    create: isAuthorOrEditor,
    update: isAuthorOrEditor,
    delete: isAuthorOrEditor,
  },
  hooks: { beforeValidate: [autoSlug] },
});
