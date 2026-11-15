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

**The SEO plugin states the site's X account, and gives site code its content dates.** `socialCard.xAccount` (experimental) names the site's X (Twitter) account, as a handle with or without the `@` or a profile address such as `https://x.com/example`, and every page's head then carries `<meta name="twitter:site" content="@example">`; anything else stops the plugin at start with an error that says so. The page-metadata answer gains `social.xAccount` for it. `seoLastChanged` (experimental, from `@nextlyhq/plugin-seo`) gives a site's own sitemap or `og:article:modified_time` the date the plugin's sitemap uses, when the page's content last changed, instead of `updatedAt`, which every save moves, an SEO-only one included: `seoLastChanged({ collection: "posts", entries: posts })` dates a whole list in one query per hundred entries, and an entry with no date kept falls back to its own `updatedAt`.
