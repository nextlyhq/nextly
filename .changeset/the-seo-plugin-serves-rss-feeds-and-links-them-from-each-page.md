---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The SEO plugin serves the site's RSS 2.0 feeds, named in its new `feeds` option: each at `/feed.xml` or `feed.xml` in one folder, made from collections (the published pages the sitemap lists and the public may read) and from code sources, newest first, 20 items by default. Every page's head links `/feed.xml`, and a section's feed is linked from its listing page and its pages; llms.txt names each feed. `withNextly` sends `/feed.xml` and `/<folder>/feed.xml` to the plugin where the site serves nothing there (`feedFiles: false` turns that off), and a page's answer can carry `feeds`, written as titled `<link rel="alternate" type="application/rss+xml">` tags.
