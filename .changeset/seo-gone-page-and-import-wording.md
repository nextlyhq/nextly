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

The SEO plugin's Import no longer says a value was "never served". Where a page's code now sets
its own title or description, a different stored value is still skipped unless included, and the
screen and the report say what the plugin knows: the page's code sets its own value now, so
importing this one would change what the page shows; include it if the page showed it before and
should again.

A site can show its own page for an address made Gone: `seoPlugin({ gonePage: "/gone" })`
(experimental). The Proxy reads that page and answers with it and status 410; where it can't be
read or doesn't answer 200, the short plain page is sent, still with 410. The SEO docs also show
how to log addresses not found from Next.js's `global-not-found` page with `logNotFound`.
