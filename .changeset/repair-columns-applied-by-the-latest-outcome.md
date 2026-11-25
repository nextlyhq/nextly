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

`nextly repair-columns` takes a migration as applied from its latest outcome, as `nextly migrate` does. An attempt recorded after it that failed, stopped or was cleared made the command judge columns by the migration before it, and `--apply` converted correct columns back.

`nextly repair-columns` converts nothing from an older snapshot while a newer migration is applied. It stops, with exit code 1, its dry run included, in two cases it went on in before:

- The checkout lacks a migration the database has applied (`MIGRATION_MISSING`). Pull the missing migration. If its file was removed on purpose, record that with `nextly migrate:resolve --removed <file>`.
- An applied migration newer than the newest applied snapshot has no snapshot (`MISSING_SNAPSHOT`). Restore the snapshot from version control. A blank migration and a localization migration do not stop it.
