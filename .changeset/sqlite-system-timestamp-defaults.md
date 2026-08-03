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

On SQLite, the `createdAt` and `updatedAt` columns of collection and single tables now carry a database default, matching PostgreSQL and MySQL and matching what the Schema Builder has always created.

Nextly sets both on every write, so content created through the admin panel or the API is unaffected. The difference shows up for rows written another way, such as a direct insert or a data import: on SQLite those stored no timestamp at all, and the value read back as null.

Existing SQLite tables pick the default up on the next schema sync, which rebuilds the affected tables in place and preserves their rows. Rows that already hold a null timestamp keep it, because a default applies only to inserts that omit the column.
