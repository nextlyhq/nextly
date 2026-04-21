/**
 * Posts collection: the core content type for the blog.
 *
 * Content fields (title, content, featuredImage, excerpt) plus editorial
 * controls (author, categories, tags, status, featured) plus computed
 * fields (readingTime, wordCount) plus a per-post SEO group for rich
 * social previews and search-engine overrides.
 */
import {
  defineCollection,
  text,
  textarea,
  richText,
  date,
  select,
  checkbox,
  number,
  upload,
  relationship,
  group,
} from "@revnixhq/nextly/config";

import { autoSlug } from "@/hooks/auto-slug";

import { computeReadingTime } from "./hooks/reading-time";
import { requireFeaturedAlt } from "./hooks/require-featured-alt";

export const Posts = defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    text({ name: "title", required: true }),
    text({ name: "slug", required: true, unique: true }),
    richText({ name: "content" }),
    upload({ name: "featuredImage", relationTo: "media" }),
    // Author: the post belongs to a user. Public-facing author profile
    // at `/authors/[slug]` resolves to a user by their `slug` extension
    // field. See blog/configs/codefirst.config.ts for the user extension.
    relationship({ name: "author", relationTo: "users" }),
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
    select({
      name: "status",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
      ],
      defaultValue: "draft",
    }),
    // Computed by the computeReadingTime hook - writers don't edit these.
    number({ name: "readingTime", admin: { readOnly: true } }),
    number({ name: "wordCount", admin: { readOnly: true } }),
  ],
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "status", "author", "publishedAt"],
  },
  hooks: {
    beforeValidate: [autoSlug, requireFeaturedAlt],
    beforeChange: [computeReadingTime],
  },
});
