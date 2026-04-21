/**
 * Authors collection: separate from admin users so guest authors can be
 * represented without needing admin accounts.
 *
 * Note: this collection is scheduled for removal in Task 17 Sub-task 3
 * (users-as-authors migration). At that point posts.author will relate
 * directly to `users` and this file disappears. Kept here for now so the
 * architecture refactor (Task 17 Sub-task 2) stays a pure reorganization
 * with no behavioral changes.
 */
import {
  defineCollection,
  text,
  textarea,
  upload,
  group,
} from "@revnixhq/nextly/config";

import { autoSlug } from "@/hooks/auto-slug";

export const Authors = defineCollection({
  slug: "authors",
  labels: { singular: "Author", plural: "Authors" },
  fields: [
    text({ name: "name", required: true }),
    text({ name: "slug", required: true, unique: true }),
    textarea({ name: "bio" }),
    upload({ name: "avatar", relationTo: "media" }),
    group({
      name: "social",
      fields: [
        text({ name: "twitter" }),
        text({ name: "github" }),
        text({ name: "linkedin" }),
        text({ name: "website" }),
      ],
    }),
  ],
  admin: { useAsTitle: "name" },
  hooks: { beforeValidate: [autoSlug] },
});
