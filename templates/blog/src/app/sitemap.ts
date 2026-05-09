/**
 * sitemap.xml - auto-generated from published content.
 *
 * Included routes: homepage, /blog, /categories, /tags, every
 * published post, every category archive, every tag archive, every
 * author page. The /archive route from earlier versions of this
 * template has been removed (replaced by the paginated /blog). If
 * you add new static routes, register them in `staticPages` below.
 *
 * Next.js serves this at /sitemap.xml. `metadataBase` in the root
 * layout resolves relative URLs; here we emit absolute URLs for
 * clarity and to match what search engines expect.
 */

import type { MetadataRoute } from "next";

import {
  getAllAuthorSlugs,
  getAllCategorySlugs,
  getAllPostSlugs,
  getAllTagSlugs,
} from "@/lib/queries";
import { absoluteUrl } from "@/lib/site-url";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, authors, categories, tags] = await Promise.all([
    getAllPostSlugs(),
    getAllAuthorSlugs(),
    getAllCategorySlugs(),
    getAllTagSlugs(),
  ]);

  const staticPages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/blog"), changeFrequency: "daily", priority: 0.9 },
    {
      url: absoluteUrl("/categories"),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    { url: absoluteUrl("/tags"), changeFrequency: "weekly", priority: 0.6 },
  ];

  const postPages = posts.map(slug => ({
    url: absoluteUrl(`/blog/${slug}`),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const categoryPages = categories.map(slug => ({
    url: absoluteUrl(`/categories/${slug}`),
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  const tagPages = tags.map(slug => ({
    url: absoluteUrl(`/tags/${slug}`),
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  const authorPages = authors.map(slug => ({
    url: absoluteUrl(`/authors/${slug}`),
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  return [
    ...staticPages,
    ...postPages,
    ...categoryPages,
    ...tagPages,
    ...authorPages,
  ];
}
