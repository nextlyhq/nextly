# @nextlyhq/plugin-seo

> Nextly is in alpha. APIs may change before 1.0.

First-party SEO plugin for Nextly. It is **opt-in** and **framework-agnostic** (zero `next` dependency), so it is safe in every deployment mode — an integrated site, a headless setup feeding a separate frontend, or an internal admin tool. You add it only to the collections that need SEO.

This package owns the SEO **data**: the meta fields and (in a later Tier-0 PR) the sitemap contents. The Next-only **behavior** (turning those fields into `generateMetadata`, delivering the canonical `/sitemap.xml`, and content routing) ships separately from `nextly/runtime`, so this plugin never drags Next.js into a headless or admin-only project.

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
import { text } from "nextly";
import { seoPlugin } from "@nextlyhq/plugin-seo";

seoPlugin({
  collections: ["pages"],
  fields: [text({ name: "focusKeyword" })],
});
```

### Localized SEO

For multilingual sites, opt into per-locale SEO so each translation gets its own meta title, description, canonical, etc.:

```ts
seoPlugin({ collections: ["pages"], localized: true });
```

Enable this **only** when the target collections have localization configured (`locales` + `defaultLocale`); Nextly rejects a localized field on a non-localized entity. It defaults to `false`, so the plugin is safe on monolingual projects.

## License

MIT © Nextly
