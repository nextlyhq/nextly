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

Sites that render their own pages now get the SEO plugin's head and structured data without workarounds.

- `singlePageMetadata` and `singlePageStructuredData` (from `nextly/runtime`) answer a Single a site reads itself, as `contentPageMetadata` and `contentPageStructuredData` answer an entry. Both take the address the page was served at, so a later page of a Single's list (`/blog/page/2`) gets its own canonical; Single routes take the same address as a new `path` option.
- `seoStructuredData(path, options)` (from `@nextlyhq/plugin-seo`) gives a page built in code its structured data from the same answer as `seoMetadata`.
- `jsonLdScriptProps(data)` (from `nextly/runtime`) places structured data in a page, `<script {...jsonLdScriptProps(data)} />`, escaped so no value can end the element.
- The plugin's title is served as `title: { absolute }`, so a root layout's `title.template` no longer adds the site name a second time. A route's own title keeps the form the route gave it.
- A route's `noindex` (and `nofollow`) is kept: the route can hide a page, never list one the plugin hides, and a page built in code its route hides leaves the plugin's sitemap. Google's `max-image-preview`, `max-snippet` and `max-video-preview` limits and the route's other robots directives are kept.
- A page the plugin gives no canonical, such as one whose type declares no public address, keeps the canonical and `og:url` its route set.
- A page served before anything in its worker started Nextly (every read a cache hit, or prerendered by `next build`) now starts it and is served the plugin's answer, rather than silently its route's own head.
