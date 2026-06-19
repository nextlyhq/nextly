# @nextlyhq/plugin-seo

> ⚠️ **Alpha.** Part of the Nextly plugin platform. The public surface is
> `@experimental` and may change between alpha releases — pin a version.

A first-party SEO plugin for [Nextly](https://nextlyhq.com). It:

- **Adds SEO meta fields** (`metaTitle`, `metaDescription`) to the content
  collections you choose, via `contributes.extend`.
- Declares a **`manage-seo`** permission (define-but-never-grant; assign it to
  roles yourself).
- Serves a **sitemap** of your published entries, cached and automatically
  invalidated whenever a target collection changes.

## Install

```bash
npm install @nextlyhq/plugin-seo
```

## Usage

```ts
// nextly.config.ts
import { defineConfig } from "nextly/config";
import { seo } from "@nextlyhq/plugin-seo";

export default defineConfig({
  plugins: [
    seo({
      collections: ["pages", "posts"],
      baseUrl: "https://example.com",
    }).plugin,
  ],
});
```

Then run `nextly migrate` — `collections: ["pages", "posts"]` get the SEO meta
fields added to their schema.

### Options

| Option        | Type                            | Description                                                                   |
| ------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| `collections` | `string[]`                      | Collections to extend with SEO fields **and** include in the sitemap.         |
| `baseUrl`     | `string`                        | Absolute base URL for sitemap `<loc>` (e.g. `https://example.com`).           |
| `urlFor?`     | `(entry, collection) => string` | Build an entry's path. Defaults to `/<collection>/<entry.slug>`.              |
| `fields?`     | `FieldConfig[]`                 | Override the contributed fields (e.g. add a `metaImage` upload or canonical). |

Target collections should have a `slug` field (for URLs) and a `status` field
(only `status: "published"` entries appear in the sitemap).

## Sitemap

Plugin routes are namespaced, so the sitemap is served at:

```
/api/plugins/@nextlyhq/plugin-seo/sitemap.xml
```

Expose it at the conventional root path with a Next.js rewrite:

```ts
// next.config.ts
export default {
  async rewrites() {
    return [
      {
        source: "/sitemap.xml",
        destination: "/api/plugins/@nextlyhq/plugin-seo/sitemap.xml",
      },
    ];
  },
};
```

The sitemap is generated on demand, cached in memory, and invalidated when any
target collection emits a `created` / `updated` / `deleted` event.

## License

MIT
