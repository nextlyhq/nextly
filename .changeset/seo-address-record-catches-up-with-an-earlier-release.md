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

The SEO plugin's address record no longer goes stale when servers of the earlier release keep running during a deploy. 0.0.2-alpha.76 moves the record from the collection `nx_seo_addresses` to its own tables, once, at start; a server still running 0.0.2-alpha.75 went on writing the collection afterwards, so a page it published, moved or deleted was missing from the record, and the redirects it saved were not answered. The move now keeps the collection's size and newest write, and each start (and each long-running server once more, half an hour after it starts) compares them. When they changed, the plugin rebuilds the record from the pages, makes the redirects owed for the moves those servers noted, and takes over the redirects they saved. A site that already upgraded to 0.0.2-alpha.76 while old servers ran is repaired at its first start on this release. A start where nothing changed costs one more small read and writes nothing.

A page left without its address in that repair, because another page took it meanwhile, now also marks the SEO Problems list's last full check out of date. Both moves (the address record and the not-found log) now record in `seo__notes` when they have been taken in, for the later release that stops declaring the old collections.
