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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

The database adapter's `upsert` now works on MySQL, with the meaning it has on
PostgreSQL and SQLite. It used to call a conflict clause MySQL does not have, so
every upsert there failed. On MySQL the row is now inserted first, and only a
duplicate on the conflict columns themselves is resolved, by a read that sees
rows other transactions have committed. A collision on any other unique key is
refused rather than updating a different row, and keeping an existing row runs
no update triggers. On MySQL the conflict columns must be a declared primary or
unique key and must be given values.

An upsert that names no column to update now keeps the existing row and returns
it on every dialect, without failing, so it can write a row once inside a
transaction.
