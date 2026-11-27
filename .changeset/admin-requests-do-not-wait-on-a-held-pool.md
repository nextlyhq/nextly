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

An admin request, or a Direct API call, no longer waits for the routine schema version check longer than 2 seconds while that check waits for a database connection: it is served with the schema the process already has, as a failed check already did, and the wait is logged. Previously every request on an instance whose pool was held waited the pool's whole wait (15 seconds) for it, with nothing in the log. A check that a schema change made on this instance asked for, or that found another instance's change, is still waited for in full.

Every wait for a pooled connection that runs out is now logged as a warning on PostgreSQL, MySQL and SQLite, and a failed read of the stored schema version is logged with its error code. On Vercel the PostgreSQL and MySQL pools now wait at most 5 seconds for a free connection (`pool.connectionTimeoutMs`) before failing as `DATABASE_BUSY`, rather than 15; a Neon database keeps its 20. Set `pool.connectionTimeoutMs` on the adapter to choose another wait.
