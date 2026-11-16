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

Pages can say how search results may show them. Every listed page now asks for large image previews (`max-image-preview:large`), which Google needs to show a big picture in results and in Discover; switch it off on **Settings › Search engines and AI**. Under each page's **Advanced** section in the SEO tab, a page can choose its own image preview size, a shorter text under its link or none (`max-snippet`, `nosnippet`), keep its pictures out of image search (`noimageindex`), set a date after which it leaves search (`unavailable_after`; after it the page is served `noindex` and leaves the sitemap and `llms.txt`, and the problem list names it while it is published), and switch on `noarchive` or `nocache`, each off by default and set by nothing else.

A page-metadata provider's answer may now carry these display controls in its `robots` (`PageRobots`, experimental), and the route helpers serve them; a route's own stricter limits are kept.

The new values are optional fields of the `seo` group and of the SEO settings. Nothing changes for a page that sets none, beyond the large image preview default. The SEO settings Single gains a `largeImagePreviews` column: run `nextly migrate:create` and `nextly migrate` after upgrading; until then, pages keep asking for large previews.
