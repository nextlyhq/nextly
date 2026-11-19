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

MySQL transactions now take savepoints, as PostgreSQL and SQLite transactions do. A batch create on MySQL undoes an item that fails after its row is written, such as one whose publish the workflow gate fails to settle, and keeps the rest; before, the failed item's row was kept. On TiDB, which may refuse `SAVEPOINT`, a transaction takes none, and such a failure still rolls the whole batch back. On every dialect, an `afterCommit` effect registered by an item that was undone this way no longer runs when the batch commits. A savepoint lost with its transaction (MySQL rolls a whole transaction back on a deadlock) now aborts the transaction, a version insert on it included, instead of reporting the wrong error. MySQL's `supportsSavepoints` stays `false`: a transaction opened inside another still joins it flat.
