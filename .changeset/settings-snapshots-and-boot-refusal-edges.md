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

A production boot with `db.runMigrationsOnBoot` now refuses a pending Schema Builder migration file with no snapshot beside it, as `nextly migrate` does, rather than applying it as written.

A plugin option holding a list named `fields` or `blocks` is recorded in a migration snapshot as it is written. The `access` key of its entries was dropped, as though they were field declarations, so a change to it produced no settings migration and no `SETTINGS_DRIFT`.

Removing the last hook from a code-first collection or Single no longer reads as a settings change. Code-first hooks are functions, which snapshots do not record, so `nextly migrate:create` wrote a migration for nothing and `nextly migrate:check` failed until it was committed.
