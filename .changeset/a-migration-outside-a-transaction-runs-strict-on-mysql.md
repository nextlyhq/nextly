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

On MySQL, a migration file marked to run outside a transaction now runs in
strict mode, as every transactional file already does.

`nextly migrate` runs a file marked `-- nextly:no-transaction`, or a plugin
module with `transaction: false`, statement by statement, each committing as it
runs. Until now those statements went to the connection pool one at a time with
the server's own `sql_mode`. On a MySQL server that isn't in strict mode, a
statement such as `ALTER TABLE … MODIFY COLUMN v varchar(255)` over a longer
stored value cut that value short with only a warning, and a migration runs with
nobody there to read one.

The statements of such a file now share one connection whose session runs with
`STRICT_ALL_TABLES` added to its mode, so that statement fails and the value
stays. The session's own mode is put back before the connection returns to the
pool, whether the file finished or failed. PostgreSQL and SQLite run as before.

**Compatibility:** a hand-written no-transaction file on MySQL that relied on the
server's non-strict coercion, for example inserting an overlong value expecting
it to be cut, now fails at that statement. The statements before it stay
applied, as for any no-transaction file, and the error says how many.

Database adapters gain `withSession(work, { strictSqlMode })`, which runs
statements on one connection outside a transaction; on MySQL the option sets
strict mode for that session and restores it afterwards.
