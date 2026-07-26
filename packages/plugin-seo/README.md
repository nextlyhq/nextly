# @nextlyhq/plugin-seo

> Nextly is in alpha. APIs may change before 1.0.

First-party SEO plugin for Nextly. It is **opt-in** and **framework-agnostic** (zero `next` dependency), so it is safe in every deployment mode — an integrated site, a headless setup feeding a separate frontend, or an internal admin tool. You add it only to the collections that need SEO.

This package is **framework-agnostic** (zero `next`): it adds SEO fields to your content and serves a sitemap of your published content over plain HTTP, nothing Next-specific, so it is safe in headless and admin-only projects. Turning the SEO fields into `<meta>` tags and wiring a canonical `app/sitemap.ts` / `robots.ts` are your app's job today; first-party Next.js helpers for that are planned as a separate, opt-in package.

## Install

```bash
npm install @nextlyhq/plugin-seo
```

## Usage

Register it in your Nextly config and name the collections that should have SEO:

```ts
import { defineConfig } from "nextly/config";
import { seoPlugin } from "@nextlyhq/plugin-seo";

export default defineConfig({
  collections: [
    /* pages, posts, ... */
  ],
  plugins: [seoPlugin({ collections: ["pages", "posts"] })],
});
```

That adds an `seo` field group to each named collection:

| Field             | Type             | Notes                                                  |
| ----------------- | ---------------- | ------------------------------------------------------ |
| `metaTitle`       | text             | Truncated by search engines past ~60 chars             |
| `metaDescription` | textarea         | Truncated past ~160 chars                              |
| `ogImage`         | upload → `media` | Social share image                                     |
| `canonical`       | text             | Canonical URL (shipped by default)                     |
| `noindex`         | checkbox         | Hide the page from search engines (shipped by default) |

Entries expose the data nested under `seo` (e.g. `entry.seo.metaTitle`). Collections you do not name are untouched.

### Custom fields

Override the fields inside the `seo` group when your project needs a different shape. Overrides stay nested under `seo` (so this lands at `entry.seo.focusKeyword`):

```ts
import { text } from "@nextlyhq/plugin-sdk";
import { seoPlugin } from "@nextlyhq/plugin-seo";

seoPlugin({
  collections: ["pages"],
  fields: [text({ name: "focusKeyword" })],
});
```

## Sitemap

The plugin serves a sitemap of your **published** entries — one `<url>` per entry across the named collections — at a public HTTP route:

```
GET /api/plugins/@nextlyhq/plugin-seo/sitemap.xml
```

It reads live content, so a publish or an edit is reflected on the next request. Drafts and any entry with `seo.noindex` set are left out.

```ts
seoPlugin({
  collections: ["pages", "posts"],
  // Absolute origin used for <loc>. When omitted, the route uses the request
  // origin — correct for a single-origin deployment, wrong behind a host-
  // rewriting proxy, so set it explicitly there.
  baseUrl: "https://example.com",
  // Path per entry (leading slash). Defaults to `/<collection>/<slug>`.
  urlFor: (entry, collection) =>
    collection === "posts" ? `/blog/${entry.slug}` : `/${entry.slug}`,
});
```

A headless frontend can point crawlers at this URL (or proxy it to `/sitemap.xml`). An integrated Next.js app can also read the data through the planned Next helpers to serve the canonical `/sitemap.xml`.

## License

MIT © Nextly
