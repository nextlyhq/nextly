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
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

A Schema Builder one-to-one relationship stays unique when a save changes its
table, and a SQLite save no longer drops a table's triggers.

Adding a relationship to a Builder collection, or changing a field's type on
SQLite, rebuilt or altered the table in a way that dropped the UNIQUE the
Builder gives a one-to-one relationship's column, on SQLite and PostgreSQL, so
the column then accepted duplicates. While a table held such a column, a
SQLite save of another collection could also be refused. Both now keep the
constraint. A SQLite save that would rebuild a table with triggers on it is
refused, naming the table, instead of dropping the triggers; make that change
with a migration that recreates them.
