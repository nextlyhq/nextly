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

`nextly migrate` reads a hand-written migration's indexes, keys and constraints the same way however the statement is written, before it records the file applied without running it. On PostgreSQL and SQLite, a key or exclusion declared in a `CREATE TABLE` body (`UNIQUE NULLS NOT DISTINCT`, `EXCLUDE`, SQLite's `UNIQUE (c DESC)`) is now refused as not shown by the snapshot, as its `ALTER TABLE ... ADD CONSTRAINT` spelling already was, and an unnamed `ALTER TABLE ... ADD EXCLUDE` or `ADD UNIQUE NULLS NOT DISTINCT` is no longer read as adding a column. A MySQL index whose unquoted name is an order word (`INDEX nulls (c)`) is no longer refused. A key named inside a column that references an unquoted table named like a keyword (`REFERENCES generated (id) DEFERRABLE`) has its deferrability read. On SQLite, a table whose key is declared AUTOINCREMENT at the table's level (`PRIMARY KEY (id AUTOINCREMENT)`) has its counter checked as the column form's is, instead of being refused. Files `nextly migrate:create` writes are unaffected.
