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

On SQLite, a run that asks for the schema lock while another connection holds the database now stops with `NEXTLY_TABLE_BUSY`, naming the lock's table, if the database stays busy. Before, SQLite's own "database is locked" (`SQLITE_BUSY`) reached the caller. A command (`nextly migrate`, `migrate:down`, `plugins install` and the others that wait for a held lock) waits for the database in the tries a schema change waits for a busy table with: 5 seconds a try and 90 in all by default, shared by every step of taking the lock. Its `--lock-timeout` and `--lock-timeout-total` flags bound this wait too where the command has them, over `NEXTLY_LOCK_TIMEOUT` and `NEXTLY_LOCK_TIMEOUT_TOTAL`; a value out of its range refuses the run only once the database is found busy. A Schema Builder save, or any other request, asks once, waiting as its connection is set to, and then answers with the same error. PostgreSQL and MySQL are unchanged.
