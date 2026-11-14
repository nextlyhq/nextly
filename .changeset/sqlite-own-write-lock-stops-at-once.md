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

On SQLite, a schema change whose own transaction holds the database's write lock no longer reads a write made inside that transaction, on a second connection to the same database, as a table another session holds. That write waits for the transaction's own lock, which no wait can free, so the change now stops at its first try with `NEXTLY_LOCK_HELD_BY_THIS_PROCESS` (CLI code `LOCK_HELD_BY_THIS_PROCESS`), says this process holds the lock, and rolls back, instead of trying again until its bounds ran out and stopping as `NEXTLY_TABLE_BUSY` naming a table that was not the one waiting. A lock another connection holds on its own still gets the change's tries. PostgreSQL and MySQL are unchanged.
