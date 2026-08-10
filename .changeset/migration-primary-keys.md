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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Declare the primary key in generated `CREATE TABLE` statements. Every table a migration created was key-less: the desired snapshot has carried the marker since the diff needed it to exempt primary keys from the nullability comparison, and the SQL renderer dropped it. Any project whose tables were created by `nextly migrate` has content tables with no primary key, no uniqueness enforcement on `id`, and no primary-key index. Existing migration files are unchanged; new ones declare the key, and a table already created without one needs a corrective migration.

Live introspection now records the primary key too, so a snapshot taken from a database describes the key it actually has. Statements generated from such a snapshot previously rebuilt the schema without one.
