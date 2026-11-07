/**
 * Authors collection: the public profile a post is credited to.
 *
 * Kept apart from the `users` account that owns a post. An account is who may
 * edit a post (`posts.author`, which the own-posts rule and the
 * author-is-creator hook read); an author is who a reader is shown
 * (`posts.byline`): a name, a page at `/authors/<slug>`, a bio and an avatar.
 * Accounts are private, so a public page, and a template built with the page
 * builder, can read an author's profile only from a collection anyone may
 * read. `account` links a profile to the account it belongs to, so a post an
 * account writes is credited to its profile.
 */
import { defineCollection, relationship, text, textarea } from "nextly/config";

// Relative imports (not `@/*` alias) because Nextly's CLI loads this
// file through plain Node.js module resolution; see codefirst.config.ts.
import { anyone } from "../access/anyone";
import { hasPermission } from "../access/has-permission";
import { autoSlug } from "../hooks/auto-slug";

export const Authors = defineCollection({
  slug: "authors",
  labels: { singular: "Author", plural: "Authors" },
  fields: [
    text({ name: "name", required: true }),
    // `/authors/<slug>` finds an author by it.
    text({ name: "slug", required: true, unique: true }),
    textarea({ name: "bio", maxLength: 500 }),
    relationship({
      name: "account",
      relationTo: "users",
      admin: {
        description:
          "The account this profile belongs to. Posts that account writes are credited to this author.",
      },
    }),
  ],
  admin: { useAsTitle: "name" },
  access: {
    read: anyone,
    create: hasPermission,
    update: hasPermission,
    delete: hasPermission,
  },
  hooks: { beforeValidate: [autoSlug] },
});
