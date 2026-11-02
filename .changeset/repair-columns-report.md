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

A new `nextly repair-columns` command reports every column whose type or nullability differs from its field, on the tables Nextly builds from field definitions (collections, Singles, field groups, user fields and their translation tables). Each column is judged against its field as the database last had it applied, read from the newest applied migration snapshot (or, where none records the entity, its registry row): a missing table or column is reported as not migrated, and a change that no migration has applied yet (including an entity or user field no migration has created) as pending, pointing to `migrate:create`. A plugin's column names the plugin, and where it can the report says why a column differs: created before a named release, or by a generator that still creates it. It changes nothing in the database, and it refuses to give a verdict when an applied migration snapshot cannot be read.
