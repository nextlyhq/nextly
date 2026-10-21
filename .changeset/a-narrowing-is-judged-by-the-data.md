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

A column narrowed to `varchar(N)` is judged by the values it holds, and `nextly migrate` runs in strict mode on MySQL.

On MySQL, Single and field-group tables made before their tables came from the schema pipeline hold a `text` field as `TEXT`, where the schema declares `VARCHAR(255)`. Every `db:sync` and dev reload asked to narrow them in a terminal, and failed without one.

- `db:sync`, the dev reload and an admin schema save now count the stored values longer than N before narrowing a string column to `varchar(N)`. When there are none, the change loses nothing and applies without a prompt. When there are some, the apply stops before any DDL and names the table, the column and the number of rows; shorten those values, or give the field a type that holds them, and apply again.
- `nextly migrate`, `migrate:down`, `migrate:resolve` and plugin migrations run each migration not marked `-- nextly:no-transaction` on MySQL with `STRICT_ALL_TABLES` added to the session's mode, and puts the session's mode back afterwards. A file that would cut a value short — such as the `MODIFY COLUMN … varchar(255)` that `migrate:create` writes after `migrate:baseline` adopts one of these tables — now fails with "Data too long" at that statement, which changes nothing (schema statements before it in the same file stay applied, as MySQL commits them), where a server without strict mode used to truncate the value with only a warning. A hand-written migration that relied on MySQL's non-strict coercion now fails the same way.
- The MySQL adapter's `transaction()` takes a new `strictSqlMode` option, which does this for any transaction. PostgreSQL and SQLite ignore it.
