/**
 * sitemap.xml - auto-generated from published content.
 *
 * Built with Nextly's `nextlySitemap` helper: the `entries` provider aggregates
 * the published post/category/tag/author slugs plus the static pages, and the
 * helper wraps the read in Nextly's F1 cache. Passing the collections' tags
 * (`nextlyTags(...)`) means a create/update/publish/delete in any of them busts
 * `/sitemap.xml` in lockstep with the pages — no manual revalidation.
 *
 * Included routes: homepage, /blog, /categories, /tags, every published post,
 * every category archive, every tag archive, every author page. If you add new
 * static routes, register them in `staticPages` below.
 */

import { nextlySitemap, nextlyTags } from "nextly/runtime";

import {
  getAllAuthorSlugs,
  getAllCategorySlugs,
  getAllPostSlugs,
  getAllTagSlugs,
} from "@/lib/queries";
import { absoluteUrl } from "@/lib/site-url";

export default nextlySitemap({
  // A write to any of these collections busts the cached sitemap.
  tags: [
    ...nextlyTags("posts"),
    ...nextlyTags("categories"),
    ...nextlyTags("tags"),
    ...nextlyTags("users"),
  ],
  // A finite safety window on top of tag busting: the `users` collection does
  // not emit write-side cache tags, so an added/renamed author would otherwise
  // wait for an unrelated post/category/tag write; this also bounds how long a
  // partial result (if a slug query hits a transient DB error and returns an
  // empty list) can stay cached.
  revalidate: 3600,
  entries: async () => {
    const [posts, authors, categories, tags] = await Promise.all([
      getAllPostSlugs(),
      getAllAuthorSlugs(),
      getAllCategorySlugs(),
      getAllTagSlugs(),
    ]);

    return [
      { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
      { url: absoluteUrl("/blog"), changeFrequency: "daily", priority: 0.9 },
      {
        url: absoluteUrl("/categories"),
        changeFrequency: "weekly",
        priority: 0.6,
      },
      { url: absoluteUrl("/tags"), changeFrequency: "weekly", priority: 0.6 },
      ...posts.map(slug => ({
        url: absoluteUrl(`/blog/${slug}`),
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
      ...categories.map(slug => ({
        url: absoluteUrl(`/categories/${slug}`),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
      ...tags.map(slug => ({
        url: absoluteUrl(`/tags/${slug}`),
        changeFrequency: "weekly" as const,
        priority: 0.5,
      })),
      ...authors.map(slug => ({
        url: absoluteUrl(`/authors/${slug}`),
        changeFrequency: "weekly" as const,
        priority: 0.5,
      })),
    ];
  },
});
