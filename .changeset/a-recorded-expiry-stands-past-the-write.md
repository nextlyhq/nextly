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

Fixed: in an app without nextly's cache handlers, a write made outside a request (a job, a script) or one whose cache expiry failed inside a request is expired in Next.js's own cache again at the next request, as before the cache tag expiry ledger was connected at startup. The ledger records it for nextly's handlers, and Next.js's own cache never reads that record, so a read cached without a revalidate time could otherwise keep the previous version.

Other instances now treat a recorded cache tag expiry as standing for one second past the write, the time an instance may keep a collection's settings cached. An entry another instance fills from settings cached before a schema change is therefore not served once the change is recorded. The instance that made the write isn't held to that second, since it cleared its own cached settings at once, and a tag that expires again never has its recorded time moved back.

A write made while nextly is restarting, after one registration released the ledger and before the next one connects it, is now kept and recorded by the next ledger, instead of reaching only the instance that made it.
