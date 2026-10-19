/**
 * Categories collection: simple taxonomy for organizing posts.
 * Trivial shape (3 fields, one shared hook) so it lives as a single file
 * alongside Posts/ rather than a folder.
 */
import { defineCollection, text, textarea } from "nextly/config";

// Relative imports (not `@/*` alias) because Nextly's CLI loads this
// file via Node.js, not the Next.js resolver. See Posts/index.ts.
import { anyone } from "../access/anyone";
import { hasPermission } from "../access/has-permission";
import { autoSlug } from "../hooks/auto-slug";

export const Categories = defineCollection({
  slug: "categories",
  labels: { singular: "Category", plural: "Categories" },
  fields: [
    text({ name: "name", required: true }),
    text({ name: "slug", required: true, unique: true }),
    text({ name: "icon" }),
    textarea({ name: "description" }),
  ],
  admin: { useAsTitle: "name" },
  // Public can read categories; curating them needs the matching permission.
  access: {
    read: anyone,
    create: hasPermission,
    update: hasPermission,
    delete: hasPermission,
  },
  hooks: { beforeValidate: [autoSlug] },
});
