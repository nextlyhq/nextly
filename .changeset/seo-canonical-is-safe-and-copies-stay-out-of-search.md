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

The SEO plugin keeps every copy of a site out of search: its Proxy handler sends `X-Robots-Tag: noindex` from any host but the production addresses (`NEXTLY_PRODUCTION_ADDRESSES`, or the SEO settings), and a site with no address known stays listable if it already has pages and is kept out of search if it has none. A page whose address another page holds gets no canonical, and a typed canonical is taken only on the site itself unless `canonicalElsewhere` says the page first appeared elsewhere.

A plugin can ask `ctx.publicAddresses.defaultLanguage()` for the language an address is held in where a read names none: the site's default language as it is now, one chosen in Settings included.
