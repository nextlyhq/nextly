---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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

Collections and singles created through the Schema Builder now get their system columns from the same definition the runtime schema and the migration diff already use, instead of a separate hand-written copy.

The copy had drifted. A Builder-created table declared `createdAt` and `updatedAt` as required while the rest of Nextly described them as optional, so `nextly db:sync` proposed a change to those columns on every Builder collection, and applying it rebuilt the table. On SQLite that rebuild also dropped the timestamp defaults. Both now agree, and the sync proposes nothing.

Newly created Builder tables declare the two timestamp columns as optional. Existing tables are brought in line by one schema sync, which preserves their rows.

The practical effect is that a system column added to Nextly in future reaches Builder-created tables as well as code-first ones. Previously it reached only code-first tables, and reading a Builder collection or single failed with a missing-column error.
