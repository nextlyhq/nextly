/**
 * Posts collection: the core content type for the blog.
 *
 * Content fields (title, content, featuredImage, excerpt) plus editorial
 * controls (author, categories, tags, featured) plus computed fields
 * (readingTime, wordCount) plus a per-post SEO group for rich social
 * previews and search-engine overrides. Draft/Published lifecycle is
 * provided by Nextly's built-in `status: true` on the collection.
 */
import {
  defineCollection,
  text,
  textarea,
  richText,
  date,
  checkbox,
  number,
  upload,
  relationship,
  group,
} from "nextly/config";

// Relative imports (not `@/*` alias) because Nextly's CLI loads the
// root nextly.config.ts via Node.js, which pulls this file transitively
// through Node's module resolver - no TypeScript path-alias support.
import { anyone } from "../../access/anyone";
import { hasPermission } from "../../access/has-permission";
import {
  mayPublishPosts,
  ownPostsUnlessPublisher,
} from "../../access/own-posts";
import { autoSlug } from "../../hooks/auto-slug";
import { refuseReservedSlug } from "../../lib/static-params";

import { authorIsCreator } from "./hooks/author-is-creator";
import { computeReadingTime } from "./hooks/reading-time";
import { requireFeaturedAlt } from "./hooks/require-featured-alt";

export const Posts = defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    text({ name: "title", required: true }),
    text({
      name: "slug",
      required: true,
      unique: true,
      validate: refuseReservedSlug,
    }),
    richText({ name: "content" }),
    upload({ name: "featuredImage", relationTo: "media" }),
    // Author: the post belongs to a user. Public-facing author profile
    // at `/authors/[slug]` resolves to a user by their `slug` extension
    // field. See blog/configs/codefirst.config.ts for the user extension.
    // Who may change a post follows its author (see `access` below), so
    // only a caller who may publish posts sets or changes it; anyone
    // else's value is dropped, and a new post becomes the caller's own
    // (the authorIsCreator hook).
    relationship({
      name: "author",
      relationTo: "users",
      access: { create: mayPublishPosts, update: mayPublishPosts },
    }),
    relationship({
      name: "categories",
      relationTo: "categories",
      hasMany: true,
    }),
    // Tags: granular cross-cutting topics. Posts can have categories,
    // tags, or both: writers pick the taxonomy that fits the content.
    relationship({
      name: "tags",
      relationTo: "tags",
      hasMany: true,
    }),
    textarea({ name: "excerpt" }),
    date({ name: "publishedAt" }),
    // Editorial pinning: homepage picks a featured post for the hero slot,
    // falling back to the latest post when nothing is marked featured.
    checkbox({ name: "featured", defaultValue: false }),
    // Per-post SEO overrides. All optional; metadata API falls back to
    // title / excerpt / featuredImage when fields are blank.
    group({
      name: "seo",
      fields: [
        text({ name: "metaTitle" }),
        textarea({ name: "metaDescription" }),
        upload({ name: "ogImage", relationTo: "media" }),
        text({ name: "canonical" }),
        checkbox({ name: "noindex", defaultValue: false }),
      ],
    }),
    // Computed by the computeReadingTime hook - writers don't edit these.
    number({ name: "readingTime", admin: { readOnly: true } }),
    number({ name: "wordCount", admin: { readOnly: true } }),
  ],
  // Why: enable Nextly's built-in Draft/Published lifecycle. Injects a
  // NOT NULL `status` system column (default 'draft') and surfaces
  // separate Save Draft / Publish buttons in the admin entry editor.
  // Replaces the previous user-defined `select({ name: "status" })` field.
  // Public Direct API callers must continue to filter explicitly via
  // `where: { status: { equals: "published" } }` — see lib/queries/*.ts.
  status: true,
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "status", "author", "publishedAt"],
  },
  // Access control: reads are public (frontend queries filter by
  // status=published for visitors). Creating, editing and deleting need
  // the matching permission on the caller's role (`create-posts`,
  // `update-posts`, `delete-posts`). Editing and deleting are then
  // narrowed by a filter: a caller who may publish posts changes every
  // post, anyone else only the posts whose `author` is them. Publishing
  // needs `publish-posts`, which only editors and admins hold.
  access: {
    read: anyone,
    create: hasPermission,
    update: ownPostsUnlessPublisher,
    delete: ownPostsUnlessPublisher,
  },
  hooks: {
    beforeValidate: [autoSlug, requireFeaturedAlt],
    beforeChange: [authorIsCreator, computeReadingTime],
  },
});
