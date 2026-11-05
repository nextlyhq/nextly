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

A page route can now draw each page inside its Layout (experimental: the option may change before it is marked stable). Pass `layouts: pageBuilderLayouts()` (from `@nextlyhq/plugin-page-builder`) to `createBlocksPage` or `createPublicBlocksPage`, and every page is served as its Layout's header, the page, then its footer. A page gets the Layout it names while that is published, otherwise the site's default Layout, and no header or footer when "No header or footer" is on. The header and footer are drawn on the server and add no JavaScript, and a page's title and description still come from the page alone.

Publishing a Layout, or a component a Layout uses, refreshes only the pages drawn inside it, and changing the default Layout refreshes only the pages that use the default. A site with no usable default serves its pages without a header or footer and logs a warning; those pages pick up the repaired default within a minute.

The option is off unless you pass it, so existing routes serve exactly what they did before.
