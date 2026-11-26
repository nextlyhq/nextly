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

`nextly repair-columns` stops, with exit code 1, its dry run included, while an attempt at a migration is unresolved and may have stopped part-way (`NEXTLY_MIGRATION_PARTIALLY_APPLIED`), as `nextly migrate` does. `--apply` undid the part of a pending migration that had run. Finish the migration's statements by hand and record it with `nextly migrate:resolve --applied`, or reverse them and run `nextly migrate:resolve --failed-cleanup` (a down section finished by hand is recorded with `--rolled-back`). Two cases that reported before stop now:

- A migration that is applied and has a later unresolved attempt. A cleared attempt does not stop it.
- A dry run while a migration or its rollback runs outside a transaction, or on MySQL, a Schema Builder save's migration included. It stops with `NEXTLY_MIGRATE_LOCK_BUSY`, naming the run. Run it again once that has ended. `--apply` waits for the lock, as before.
