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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A dialect nobody stated is now read from the connection URL.

`DB_DIALECT` carried a Zod default, so it was never absent, so the database
factory's URL fallback behind it could not run. Setting only
`DATABASE_URL=mysql://...` or `file:./data/nextly.db`, which the adapter
READMEs describe as enough, produced a PostgreSQL adapter, PostgreSQL
identifier quoting and the PostgreSQL schema tables, because all of those
read the same value.

The URL rules move to the environment schema, ahead of everything that reads
the dialect, so there is one answer rather than a second copy behind an
unreachable branch. An explicit `DB_DIALECT` still wins, and a URL that
implies nothing still defaults to PostgreSQL.
