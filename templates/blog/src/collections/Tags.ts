/**
 * Tags collection: granular cross-cutting taxonomy. Flat (no hierarchy).
 * Lives alongside Categories: categories organize the blog's IA, tags
 * surface topic connections across categories.
 */
import { defineCollection, text, textarea } from "@revnixhq/nextly/config";

// Relative imports (not `@/*` alias) because Nextly's CLI loads this
// file via Node.js, not the Next.js resolver. See Posts/index.ts.
import { anyone } from "../access/anyone";
import { isAuthorOrEditor } from "../access/is-author-or-editor";
import { autoSlug } from "../hooks/auto-slug";

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
    read: anyone,
    create: isAuthorOrEditor,
    update: isAuthorOrEditor,
    delete: isAuthorOrEditor,
  },
  hooks: { beforeValidate: [autoSlug] },
});
