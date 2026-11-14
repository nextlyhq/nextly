---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

**Sitemap dates now move only when a page's content changes.** The SEO plugin's sitemap gave each page its last save time, so a change to the page's SEO alone, or a save that changed nothing, moved its `<lastmod>`. Bing and Google trust a `lastmod` only where it is accurate. The plugin now keeps, for each page and language, a fingerprint of its published content (every field but its `seo` group and Nextly's bookkeeping) and when that last changed, in a new table of its own (`seo__content_dates`, plugin schema version 3, applied by `nextly migrate`). An SEO-only change, a save that changes nothing, a status saved again and a draft leave the date; a published content change moves it. **Sitemap dates may now stay older than before, by design.** A page last saved before upgrading shows its last save until its next one, and reading the sitemap writes nothing. A page built in code now has a `lastmod` only where its route states one, as `openGraph.modifiedTime` in the metadata it passes to `seoMetadata`; it is never given the time it was built or asked for. The problem list gains a site-wide warning for sitemap dates that keep matching the day they are checked (more than half of the addresses, and at least 20, on two full checks made on different days), which is what dates taken from a build or a request look like.
