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

A development start ensures each permission once, and skips the entities that have not changed since the last one. A start used to ensure every collection's and Single's permissions twice, one statement at a time, and read every content table's shape on each restart; an unchanged start with 50 collections sent 2,836 statements. Now the permissions are ensured once, against one read of the table, and a development start reads the tables of only the collections, Singles and field groups whose declaration changed since the last development start, as recorded in `nextly_meta`; a restart with nothing changed writes no permissions, roles, registry rows or user field definitions, and sends the same number of statements whatever the number of entities. An upgrade of Nextly, a change of database, or a change to `localization` or `experimental.perLanguageStorage` makes the next start check everything again.

Code-defined user fields are written only where they differ from what is stored: a configuration declaring none no longer deletes on every start and `db:sync`.
