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

On SQLite, a run that asks for the schema lock while another connection holds the database now waits for it in tries and, if the database stays busy, stops with `NEXTLY_TABLE_BUSY`, naming the lock's table. Before, SQLite's own "database is locked" (`SQLITE_BUSY`) reached the caller. The tries use the bounds and pauses a schema change waits for a busy table with (`NEXTLY_LOCK_TIMEOUT`, `NEXTLY_LOCK_TIMEOUT_TOTAL`; 5 seconds a try and 90 in all by default), read from the environment: a command's `--lock-timeout` flags bound its table changes, not this wait. It applies to every path that takes the lock on SQLite, a Schema Builder save included. PostgreSQL and MySQL are unchanged.
