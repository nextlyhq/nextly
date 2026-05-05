/**
 * Domain types for the blog template's frontend.
 *
 * These mirror the schema definitions in `nextly.config.ts` (or the
 * collection files under `src/collections/` in the template source).
 * When you regenerate types
 * with `pnpm types:generate`, the generated file at
 * `src/types/generated/nextly-types.ts` will contain richer types derived
 * directly from your schema — feel free to swap the imports in this file
 * for the generated ones if you want the extra precision.
 *
 * Why hand-maintained types here? Shipping the template with inline
 * types means `npx create-nextly-app` produces a project that typechecks
 * cleanly on first install, without needing a types-regen step.
 */

export interface Media {
  id: string;
  url: string;
  altText?: string | null;
}

/**
 * Author: the public-facing identity a post is attributed to.
 *
 * Backed by the `users` collection under the hood (users-as-authors
 * pattern). Fields here are the subset of User we surface on the
 * frontend. Auth fields (email, password, roles) are intentionally
 * omitted: they are admin-only and must not leak through the Direct API.
 *
 * The `avatarUrl` is a plain text URL (user-extension fields support
 * only scalar types in the current Nextly core). If you want to upgrade
 * to an upload-backed avatar, either add a top-level `avatar` upload
 * field on the users collection in core, or swap this type for `Media`
 * and update the admin flow.
 */
export interface Author {
  id: string;
  name: string;
  slug: string;
  bio?: string | null;
  avatarUrl?: string | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
}

export interface PostSeo {
  metaTitle?: string | null;
  metaDescription?: string | null;
  ogImage?: Media | null;
  canonical?: string | null;
  noindex?: boolean | null;
}

export interface Post {
  id: string;
  title: string;
  slug: string;
  content: string | Record<string, unknown> | null;
  excerpt?: string | null;
  featuredImage?: Media | null;
  author?: Author | null;
  categories?: Category[] | null;
  tags?: Tag[] | null;
  publishedAt?: string | null;
  status: "draft" | "published";
  featured?: boolean | null;
  seo?: PostSeo | null;
  readingTime?: number | null;
  wordCount?: number | null;
}

export interface SiteSettings {
  siteName: string;
  tagline: string;
  siteDescription: string;
  logo: Media | null;
  social: {
    twitter?: string | null;
    github?: string | null;
    linkedin?: string | null;
  } | null;
}

/**
 * Category / Tag with post count (used on the `/tags` and `/categories`
 * index pages to show how many posts each contains).
 */
export interface TaxonomyWithCount<T> {
  item: T;
  postCount: number;
}
