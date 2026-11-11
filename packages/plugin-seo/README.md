# @nextlyhq/plugin-seo

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0 — pin exact versions in production.
> See the [plugin stability ladder](https://nextlyhq.com/docs/plugins/stability) for
> which plugin surfaces are stable and which are experimental.

First-party SEO plugin for Nextly. It is **opt-in** and **framework-agnostic** (zero `next` dependency), so it is safe in every deployment mode — an integrated site, a headless setup feeding a separate frontend, or an internal admin tool. You add it only to the collections that need SEO.

This package is **framework-agnostic** (zero `next`): it adds SEO fields to your content and serves the site's sitemap and robots.txt over plain HTTP, nothing Next-specific, so it is safe in headless and admin-only projects. In a Next.js app, content routes get each page's head from the plugin (see [Next.js metadata](#nextjs-metadata) below).

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

## Next.js metadata

With the plugin installed, content routes and Single routes from `nextly/runtime` get each page's head from the plugin, with no call needed. Each value comes from the first level that has one: what a person typed, then the route's own `buildMetadata` (title, description and social values only), the Page Builder design, the content type's pattern, the page's content, and the site's defaults. The canonical is the page's declared address in its language. See the [SEO plugin guide](https://nextlyhq.com/docs/plugins/seo).

Without a content route, `buildMetadata` from `nextly/runtime` turns the `seo` group into a Next `Metadata` object, so a page's `generateMetadata` is one call instead of a hand-written mapping. It sets the title, description, canonical, OpenGraph, Twitter card, and `robots` (from `noindex`), with per-call fallbacks for blank fields:

```ts
// app/blog/[slug]/page.tsx
import { buildMetadata } from "nextly/runtime";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};
  return buildMetadata(post, {
    // Used when the matching seo field is blank.
    fallback: {
      title: post.title,
      description: post.excerpt,
      canonical: `/blog/${slug}`,
    },
    // Page-type specifics the seo group does not carry.
    openGraph: {
      type: "article",
      publishedTime: post.publishedAt ?? undefined,
    },
  });
}
```

Set `metadataBase` once in your root layout so a relative `canonical` resolves to an absolute URL. Pass `languages` (locale → URL) to emit `alternates.languages` (hreflang) for a localized page. `buildMetadata` lives in `nextly/runtime` (Next-only), so it stays out of the agnostic plugin.

## Sitemap and robots.txt

The plugin serves the site's `/sitemap.xml` and `/robots.txt` at the root: `withNextly()` rewrites both to Nextly's API handler, and a site that ships its own file keeps serving it.

The sitemap lists every published page of each content type that declares a public address, Singles and the homepage included, at that address. A type with none is left out, and nothing is guessed for it:

```ts
import { defineCollection, defineConfig, text } from "nextly";
import { seoPlugin } from "@nextlyhq/plugin-seo";

export default defineConfig({
  collections: [
    defineCollection({
      slug: "posts",
      status: true,
      fields: [text({ name: "title" }), text({ name: "slug" })],
      // Each post is listed, and canonical, at /blog/<slug>.
      publicAddress: "/blog/{slug}",
    }),
  ],
  plugins: [
    seoPlugin({ collections: ["posts"], baseUrl: "https://example.com" }),
  ],
});
```

Whether a page is listed is decided from the same answer its head is built from: a page hidden from search, alone or with its whole type, or whose canonical points elsewhere, is left out, and so is a page whose address the address record gives another page. `<lastmod>` follows the published page, so a working draft changes nothing, and each entry lists the page's main image. Past 50,000 addresses or 50 MB, `/sitemap.xml` is a sitemap index naming `/sitemap.xml?page=<n>`.

robots.txt lets search engines read every page but the admin, asks AI crawlers what `aiCrawlers` says (`"all"` by default, `"search"` or `"block"`), and names the sitemap by its absolute address. These are requests crawlers may ignore. Asking Google not to train (`Google-Extended`) also limits what Gemini can use.

```ts
import { defineConfig } from "nextly";
import { seoPlugin } from "@nextlyhq/plugin-seo";

export default defineConfig({
  plugins: [
    seoPlugin({
      collections: ["posts", "tags"],
      baseUrl: "https://example.com",
      // Every tag page served noindex and left out of the sitemap.
      hiddenTypes: ["tags"],
      // Ask AI crawlers that collect pages for training to stay away.
      aiCrawlers: "search",
    }),
  ],
});
```

> **The sitemap is public and reads as the system.** It lists every published page's address in the types it covers, regardless of per-collection read access. Hide a type, or narrow the list, for pages that should not be enumerable. It is built on every request: set `baseUrl` so it can be cached, and cache it in front of a large site.

```ts
import { defineConfig } from "nextly";
import { seoPlugin } from "@nextlyhq/plugin-seo";

export default defineConfig({
  plugins: [
    seoPlugin({
      collections: ["pages", "posts", "internalDocs"],
      // Only these collections' pages are listed; Singles still are.
      sitemap: { collections: ["pages", "posts"] },
    }),
  ],
});
```

Other code reads what the sitemap lists, and the pages left out because another page holds their address, through the plugin's `listedPages` service:

```ts
import { definePlugin } from "@nextlyhq/plugin-sdk";
import type { ListedPagesService } from "@nextlyhq/plugin-seo";

export default definePlugin({
  name: "acme-page-list",
  version: "1.0.0",
  nextly: ">=0.0.2",
  contributes: {
    routes: [
      {
        method: "GET",
        path: "/pages.txt",
        public: true,
        handler: async (req, ctx) => {
          const listing = ctx.services.plugins["@nextlyhq/plugin-seo"]
            ?.listedPages as ListedPagesService;
          const { pages } = await listing.list(new URL(req.url).origin);
          return new Response(pages.map(page => page.loc).join("\n"));
        },
      },
    ],
  },
});
```

`urlFor` and `basePath` no longer shape the sitemap and are deprecated: declare `publicAddress` instead. The sitemap is also still served at `/admin/api/plugins/@nextlyhq/plugin-seo/sitemap.xml`. See the [SEO plugin guide](https://nextlyhq.com/docs/plugins/seo).

## Related packages

- [`nextly`](../nextly) — `buildMetadata` from `nextly/runtime` turns these fields into tags
- [`@nextlyhq/plugin-sdk`](../plugin-sdk) — the SDK this plugin is built on

## License

MIT © Nextly
