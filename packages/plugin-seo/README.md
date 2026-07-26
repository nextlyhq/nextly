# @nextlyhq/plugin-seo

> Nextly is in alpha. APIs may change before 1.0.

First-party SEO plugin for Nextly. It is **opt-in** and **framework-agnostic** (zero `next` dependency), so it is safe in every deployment mode — an integrated site, a headless setup feeding a separate frontend, or an internal admin tool. You add it only to the collections that need SEO.

This package is **data-only** and framework-agnostic: it adds SEO fields to your content, nothing Next-specific, so it is safe in headless and admin-only projects. Turning those fields into `<meta>` tags, a sitemap, or routes is your app's job today; first-party Next.js helpers for that are planned as a separate, opt-in package.

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

## License

MIT © Nextly
