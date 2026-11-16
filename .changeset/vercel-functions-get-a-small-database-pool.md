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

On Vercel (where `VERCEL` is set), the PostgreSQL and MySQL adapters now default to a small database pool: at most 3 connections, none kept open, and idle connections closed after 5 seconds, instead of up to 10 kept for 30 seconds. Suspended Vercel function instances keep their open connections, which could exhaust small Postgres plans. Install `@vercel/functions` in the app and the adapters also hand their pool to its `attachDatabasePool`; without it they log one warning. To opt out, set `DB_POOL_MAX`, `DB_POOL_MIN` or `DB_POOL_IDLE_TIMEOUT` (or pass `pool` to the adapter): each replaces only its own default, so `DB_POOL_MAX=10` and `DB_POOL_IDLE_TIMEOUT=30000` give back a long-running server's pool. Off Vercel the pool is unchanged. Errors for a database out of connections (PostgreSQL `53300`, MySQL `1040`) or a session closed for idling (PostgreSQL `57P05`) are now reported as connection errors.
