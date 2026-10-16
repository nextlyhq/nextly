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

The database adapter's `upsert` now works on MySQL. It used to call a conflict
clause MySQL does not have, so every upsert there failed. MySQL cannot hold a
duplicate to one key, so on MySQL `upsert` accepts a table only when its
conflict columns are its one unique key besides the primary key, and refuses any
other table before writing, naming the other unique keys. On a table it accepts,
it means what it does on PostgreSQL and SQLite:

- the row is inserted first, or the row holding that key is updated, found by a
  locking read that sees rows other transactions have committed, all in the
  caller's transaction or in one of its own;
- keeping an existing row runs no update triggers;
- the row returned is the one stored, read by its primary key, even when a
  trigger changed its key;
- a primary-key collision is refused as a unique violation.

The conflict columns must be given values.

An upsert that names no column to update now keeps the existing row and returns
it on every dialect, without failing, so it can write a row once inside a
transaction.
