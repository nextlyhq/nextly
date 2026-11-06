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

Two cache handlers for `next.config`: `nextly/cache-handler` for `cacheHandler` (with `cacheMaxMemorySize: 0`) and `nextly/cache-handlers` for `cacheHandlers.default`. They keep entries in each instance's memory, at most 50 MB each, least recently used first out. Before serving an entry they ask the cache tag expiry ledger, by key, when its tags last expired, so a write recorded there from another instance or outside a request expires the entry within seconds. An answer is reused for five seconds. An entry older than the ledger keeps an expiry (seven days) is never served.

The handlers don't read the ledger yet: nextly will hand it to them at startup in a later release. Until then they expire only what their own instance expires, as Next.js's default handlers do.
