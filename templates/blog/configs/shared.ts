/**
 * Shared collection definitions for the blog template.
 *
 * Both codefirst.config.ts and both.config.ts import from here to
 * avoid duplicating 150+ lines of identical schema definitions.
 * visual.config.ts does NOT import this (it has empty collections).
 */

import {
  defineCollection,
  defineSingle,
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
  type HookHandler,
} from "@revnixhq/nextly/config";

/**
 * Reusable beforeValidate hook that auto-generates a URL slug from a
 * source field (title or name) when the slug field is not provided.
 */
const autoSlug: HookHandler = async ({ data }) => {
  // Determine the source field: prefer title, fall back to name
  const source = (data?.title || data?.name) as string | undefined;
  if (data && !data.slug && source) {
    return {
      ...data,
      slug: source
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\w-]/g, ""),
    };
  }
  return data;
};

/**
 * beforeChange hook that derives word count + reading time from the post's
 * rich text content. Stores both on the document so cards/headers can show
 * them without re-parsing on every render.
 *
 * Uses 225 WPM, the commonly cited average adult reading speed for the web.
 * Handles three content shapes so it's resilient across Lexical versions
 * and the `richTextFormat: 'html'` fetch mode.
 */
const computeReadingTime: HookHandler = async ({ data }) => {
  if (!data) return data;
  const content = data.content;
  if (!content) return data;

  let text = "";
  if (typeof content === "string") {
    // HTML string — strip tags.
    text = content.replace(/<[^>]*>/g, " ");
  } else if (typeof content === "object") {
    // Lexical JSON tree — walk for text nodes.
    const walk = (node: unknown): string => {
      if (!node || typeof node !== "object") return "";
      const n = node as { text?: string; children?: unknown[]; root?: unknown };
      if (typeof n.text === "string") return n.text;
      if (Array.isArray(n.children)) return n.children.map(walk).join(" ");
      if (n.root) return walk(n.root);
      return "";
    };
    text = walk(content);
  }

  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return {
    ...data,
    wordCount: words,
    readingTime: Math.max(1, Math.ceil(words / 225)),
  };
};

/**
 * beforeValidate hook that enforces alt text on a post's featured image.
 *
 * Rationale: the media collection is shared across many use cases, so
 * requiring alt globally creates friction. But a blog featured image
 * without alt hurts both accessibility and SEO social cards, so we
 * enforce it at the post level.
 *
 * When the Direct API isn't available in the hook context (bulk imports,
 * migrations, some CLI paths), we log and skip rather than block —
 * better a permissive save than a false positive during code paths that
 * don't populate `req.nextly`. Admin-panel saves always populate it.
 */
const requireFeaturedImageAlt: HookHandler = async ({ data, req }) => {
  if (!data?.featuredImage) return data;
  const mediaRef = data.featuredImage as string | { id?: string };
  const mediaId = typeof mediaRef === "string" ? mediaRef : mediaRef?.id;
  if (!mediaId) return data;

  const nextly = req?.nextly;
  if (!nextly) {
    console.warn(
      "[blog] requireFeaturedImageAlt: Direct API unavailable on hook context — skipping alt check."
    );
    return data;
  }

  const media = await nextly
    .findByID({ collection: "media", id: mediaId })
    .catch(() => null);

  // Media records use `altText` (stored as alt_text in the database).
  // Missing / empty altText blocks the save with a clear message to the
  // writer — they can fix it by editing the media entry in the admin.
  if (media && !media.altText) {
    throw new Error(
      "Featured image must have alt text. Edit the media entry and add a description."
    );
  }
  return data;
};

// Posts collection - the core content type for the blog.
// Content fields (title, content, featuredImage, excerpt) plus editorial
// controls (author, categories, tags, status, featured) plus computed
// fields (readingTime, wordCount) plus a per-post SEO group for rich
// social previews and search-engine overrides.
export const posts = defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    text({ name: "title", required: true }),
    text({ name: "slug", required: true, unique: true }),
    richText({ name: "content" }),
    upload({ name: "featuredImage", relationTo: "media" }),
    relationship({ name: "author", relationTo: "authors" }),
    relationship({
      name: "categories",
      relationTo: "categories",
      hasMany: true,
    }),
    // Tags: granular cross-cutting topics. Posts can have categories,
    // tags, or both — writers pick the taxonomy that fits the content.
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
    // title/excerpt/featuredImage when fields are blank.
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
    // Computed by the computeReadingTime hook — writers don't edit these.
    number({ name: "readingTime", admin: { readOnly: true } }),
    number({ name: "wordCount", admin: { readOnly: true } }),
  ],
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "status", "author", "publishedAt"],
  },
  hooks: {
    beforeValidate: [autoSlug, requireFeaturedImageAlt],
    beforeChange: [computeReadingTime],
  },
});

// Authors collection - separate from admin users so guest authors
// can be represented without needing admin accounts. Social group
// mirrors the siteSettings.social pattern for consistency.
export const authors = defineCollection({
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

// Categories collection - simple taxonomy for organizing posts.
export const categories = defineCollection({
  slug: "categories",
  labels: { singular: "Category", plural: "Categories" },
  fields: [
    text({ name: "name", required: true }),
    text({ name: "slug", required: true, unique: true }),
    textarea({ name: "description" }),
  ],
  admin: { useAsTitle: "name" },
  hooks: { beforeValidate: [autoSlug] },
});

// Tags collection - granular cross-cutting taxonomy. Flat (no hierarchy).
// Lives alongside categories: categories organize the blog's IA, tags
// surface topic connections across categories.
export const tags = defineCollection({
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

// Site settings - global configuration for the blog.
// Used by the Header and Footer components to display
// the site name, tagline, logo, and social links.
export const siteSettings = defineSingle({
  slug: "site-settings",
  label: { singular: "Site Settings" },
  fields: [
    text({ name: "siteName", required: true }),
    text({ name: "tagline" }),
    textarea({ name: "siteDescription" }),
    upload({ name: "logo", relationTo: "media" }),
    group({
      name: "social",
      fields: [
        text({ name: "twitter" }),
        text({ name: "github" }),
        text({ name: "linkedin" }),
      ],
    }),
  ],
});
