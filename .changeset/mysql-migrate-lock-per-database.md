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

MySQL's migrate lock is now scoped to the database, so apps sharing a MySQL server no longer block each other's migrations. The lock was a server-wide named lock with one fixed name, so a `nextly migrate` (or a dev boot applying migrations) on one database refused, or waited, while another database on the same server was migrating. During the upgrade, don't run an old and a new `nextly migrate` against the same database at once: the two versions take differently named locks and would not exclude each other.

On MySQL, the busy-lock error no longer suggests `--force-unlock`, which has nothing to clear there: it says the lock is released when the other process's connection ends, so wait for it or stop it. PostgreSQL's message is unchanged.
