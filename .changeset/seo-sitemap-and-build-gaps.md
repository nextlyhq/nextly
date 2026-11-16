---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The SEO plugin's sitemap and the start of a site are quieter and more exact:

- An address the build answered not found (a dynamic route's page that calls `notFound()`, such as
  a topic with no posts yet) is left out of Pages, the sitemap and `llms.txt`.
- `seoStaticParams(route, generateStaticParams)` (experimental) returns a route's params unchanged
  and, during `next build` only, records the addresses they make, so a sitemap or `llms.txt` made
  during the build lists them before Next.js writes its prerender manifest, which wins after.
- A sitemap entry's images are the page's own: its share image and the image its structured data
  reads from a mapped field, such as a post's cover. The site's default share image is never
  listed, whichever level names it.
- A failed entry create that is a duplicate (409) is logged at debug, since the caller receives and
  handles it: parallel build workers recording one route no longer log warnings.
- A cache expiry made outside a request, such as at a server's start, with the cache tag ledger's
  hand-off installed, no longer logs "cache expiry failed twice"; the one line saying expiries wait
  for a request is logged once.
