# @nextlyhq/plugin-seo

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0 — pin exact versions in production.
> See the [plugin stability ladder](https://nextlyhq.com/docs/plugins/stability) for
> which plugin surfaces are stable and which are experimental.

First-party SEO plugin for Nextly. It is **opt-in** and **framework-agnostic** (zero `next` dependency), so it is safe in every deployment mode — an integrated site, a headless setup feeding a separate frontend, or an internal admin tool. You add it only to the collections that need SEO.

This package is **framework-agnostic** (zero `next`): it adds SEO fields to your content and serves a sitemap of your published content over plain HTTP, nothing Next-specific, so it is safe in headless and admin-only projects. In a Next.js app, turn the SEO fields into `<meta>` tags with `buildMetadata` from `nextly/runtime` (see [Next.js metadata](#nextjs-metadata) below); wiring a canonical `app/sitemap.ts` / `robots.ts` is still your app's job today, and first-party helpers for that are planned.

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

In a Next.js app, `buildMetadata` from `nextly/runtime` turns the `seo` group into a Next `Metadata` object, so a page's `generateMetadata` is one call instead of a hand-written mapping. It sets the title, description, canonical, OpenGraph, Twitter card, and `robots` (from `noindex`), with per-call fallbacks for blank fields:

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

## Sitemap

The plugin serves a sitemap of your **published** entries — one `<url>` per entry across the named collections — at a public HTTP route under Nextly's dynamic handler. In an app scaffolded by `create-nextly-app` (handler at `app/admin/api`), that is:

```text
GET /admin/api/plugins/@nextlyhq/plugin-seo/sitemap.xml
```

It reads live content, so a publish or an edit is reflected on the next request. Drafts, entries with `seo.noindex` set, and entries with no usable slug are left out. When an entry declares a same-host `seo.canonical` URL, the sitemap advertises that canonical URL instead of the generated one (a canonical on another host drops the entry, since a sitemap only lists URLs on its own host).

The published filter targets Nextly's built-in draft/published lifecycle (`status: true` on the collection). A collection without that lifecycle has no unpublished state, so all of its entries are listed.

```ts
seoPlugin({
  collections: ["pages", "posts"],
  // Absolute origin used for <loc>. When omitted, the route uses the request
  // origin — correct for a single-origin deployment, wrong behind a host-
  // rewriting proxy, so set it explicitly there.
  baseUrl: "https://example.com",
  // Where each collection's route is MOUNTED. Defaults to `/<collection>`.
  // Everything after the prefix is derived from the route's own answer, so this
  // is all you normally need to supply.
  basePath: collection => (collection === "posts" ? "/blog" : ""),
});
```

Each entry's path below the prefix comes from `slugToStaticParam`, the same function the content
route pre-renders from and a page's canonical is built with — so the sitemap lists the URL the page
actually serves. A nested slug (`docs/getting-started`) keeps its segments, and a slug the route
refuses to serve (a `..` segment, a stray leading or doubled slash) is skipped rather than
advertised.

The reserved-path denylist — `/admin`, `/api`, `/sitemap.xml` and the rest — is judged on the
**stored slug**, which is the value the content route itself checks: the route joins its catch-all
params, and those exclude the mount prefix. So a page stored as `admin` is skipped under every
mount, including a non-root one, because the route answers `notFound()` for it either way. Listing
it because `/pages/admin` looks unreserved would advertise a dead link.

`basePath` must be a plain path prefix. One carrying a query or fragment is rejected rather than
silently emitted as a different URL, and it is checked once per collection so an empty collection
cannot hide the misconfiguration. It is used verbatim — already-escaped prefixes such as
`/docs%20archive` are not encoded a second time.

`basePath` may be a plain string when every collection shares a prefix, and returning `null` from
the function excludes that collection from the sitemap entirely. Pass `""` for a collection served
at the site root — page-builder pages render at `/about`, not `/pages/about`.

It names the prefix only. An entry whose slug is EMPTY — a site's homepage — is skipped whatever
`basePath` says, because whether a mount's own root routes depends on the route file: a required
`[...slug]` catch-all matches no segments and 404s there, an optional `[[...slug]]` serves it. List
a homepage with `urlFor`.

For routing the prefix cannot express, `urlFor` still overrides the whole path:

```ts
seoPlugin({
  collections: ["posts"],
  baseUrl: "https://example.com",
  urlFor: entry => `/${entry.publishedYear}/${entry.slug}`,
});
```

`urlFor` owns the entire path when supplied, so `basePath` is ignored and the route-derived slug
handling above does not apply — reproduce the encoding you need yourself, and return `null` to
exclude an entry.

> **The sitemap is public and bypasses read access.** The route is unauthenticated and lists entries as the system role, so it enumerates every published entry's URL (and `lastModified`) **regardless of per-collection read access**. Do not enumerate a collection whose entries should stay private (owner-only, role-gated, or internal). Control it with the `sitemap` option:
>
> ```ts
> // Turn the sitemap route off entirely:
> seoPlugin({ collections: ["pages", "internalDocs"], sitemap: false });
>
> // Or advertise only the public subset (the rest still get SEO fields):
> seoPlugin({
>   collections: ["pages", "internalDocs"],
>   sitemap: { collections: ["pages"] },
> });
> ```

### Exposing it to crawlers

Plugin routes are namespaced under the mount point of Nextly's dynamic handler. In an app scaffolded by `create-nextly-app` that handler lives at `app/admin/api/[[...params]]/route.ts`, so this route is served at:

```text
/admin/api/plugins/@nextlyhq/plugin-seo/sitemap.xml
```

Search engines scope a sitemap to URLs beneath its own path unless it is submitted through Search Console or referenced in `robots.txt`, so a sitemap under `/admin/api/...` whose `<loc>` values live at `/<collection>/...` may be ignored. Expose it at the site root instead — for a Next.js app, add a rewrite (point `destination` at wherever your dynamic handler is mounted):

```ts
// next.config.ts
export default {
  async rewrites() {
    return [
      {
        source: "/sitemap.xml",
        destination: "/admin/api/plugins/@nextlyhq/plugin-seo/sitemap.xml",
      },
    ];
  },
};
```

Then reference `https://example.com/sitemap.xml` from `robots.txt` or submit it in Search Console. An integrated Next.js app can also read the data through the planned Next helpers to serve the canonical `/sitemap.xml` directly. A pure-headless frontend can proxy the route to its own root the same way.

> **Cache or rate-limit the public route.** It is unauthenticated and regenerates the document per request (up to the 50,000-URL / 50 MB caps), and on the `/admin/api` mount Nextly's built-in rate limiter is skipped. Put it behind an edge/CDN cache (sitemaps are crawled infrequently) or a rate limiter at your proxy — or disable it with `sitemap: false` if you don't need it.

## License

MIT © Nextly
