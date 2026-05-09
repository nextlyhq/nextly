/**
 * robots.txt — served at /robots.txt.
 *
 * Blocks `/admin` (Nextly's admin panel) and `/api` routes from being
 * indexed. Points search engines at the sitemap for efficient crawling.
 */

import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
