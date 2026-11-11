---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

User fields keep the values they are given, whichever database stores them.

- On PostgreSQL, a user's date fields are read at the instant they were written. They were read as plain timestamps, so a database whose sessions run outside UTC handed each one back shifted by its offset. The table's own `created_at` and `updated_at` were read the same way.
- On SQLite, a multi-select user field (`select` with `hasMany`) is stored. It was declared as plain text, so writing a list failed, and creating that user went ahead with every custom field left out.
- New PostgreSQL user number columns are `DOUBLE PRECISION`, as collections' numbers are and as MySQL and SQLite already store them; `REAL` rounded past seven significant digits (1234567.89 read back as 1234567.9). An existing `REAL` column is left as it is and keeps being read and written as before; `nextly repair-columns` reports it as differing.
- A user field's value that its column cannot take now fails the create or update that sends it. Before, any failed write of the custom fields went ahead without them and turned them off until the next start; that now happens only where the user fields' table does not exist yet.
