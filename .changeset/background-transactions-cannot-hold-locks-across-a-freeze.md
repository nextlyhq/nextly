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

The SEO plugin's address-record catch-up no longer leaves the site waiting on a transaction that is not running. On a serverless platform such as Vercel, a function is frozen once its response is sent. The catch-up runs after a start without being awaited, so it could be frozen with a transaction open. That transaction kept its locks on the address record for minutes. Every other function's catch-up and every save of a page then waited for those locks until its statement timed out. The waiting requests used up the database's connections, pages slowed down, and some answered 503. On PostgreSQL, each transaction the catch-up opens is now bounded by the database. A lock it waits more than 2 seconds for fails its run, and the run is tried again later. A transaction of its own left idle for 5 seconds is ended by the database, which releases its locks. A failed catch-up is now tried again at most once every 10 seconds, rather than by every request that finds the record not ready. Moving the not-found log to the plugin's table, which also runs unawaited after a start, is bounded the same way.

Plugins get the same protection through `ctx.db.withTransactionBounds({ lockWaitMs, idleMs }, work)` (experimental). It bounds every transaction the work opens, including those of the core services it calls. Adapters get the matching `withTransactionBounds` (experimental). PostgreSQL applies the bounds; MySQL and SQLite run the work unchanged.
