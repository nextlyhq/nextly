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

A published page whose address changes now leaves a permanent redirect from its old address, in the save or, after a deploy, at the next start, stored to the end of its chain and never in a loop. A page taking a redirect's address replaces it, and a redirect that cannot be saved refuses the save with the reason. The SEO plugin answers redirects from the site's Proxy before the page is served, exact addresses before `/old/*` patterns, and keeps a bounded log of the page addresses that were not found, written by `logNotFound` from the site's not-found page. `addressOfRequest(url)` from `nextly` and `@nextlyhq/plugin-sdk` answers the language and kept path a request asks for.
