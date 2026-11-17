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

Installing the Page Builder on a database whose tables were made by schema sync (a development site's start, or `nextly db:sync`) no longer stops with MIGRATION_DRIFT on the table that lists where a Single is shown. That table's migration now only creates the table, and a migration of its own right after it resets the list so the next jobs pass fills it. No released version shipped the earlier form of that migration. A development database that applied it from the `dev` branch is refused with MIGRATION_CHECKSUM_MISMATCH. Clear its ledger row with `nextly migrate:resolve --rolled-back plugin:@nextlyhq/plugin-page-builder/20261117_054612_570_create_binding_uses_table --file-missing`, then run `nextly migrate`: it records the table's migration as applied, keeps the table and its rows, and runs the reset. Or reset the database.
