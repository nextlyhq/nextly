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
"@nextlyhq/plugin-accounts": patch
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

The schema guard that stops a migration changing another owner's tables now also refuses: on PostgreSQL, an `ALTER TABLE` or `TRUNCATE` without `ONLY`, or a `DROP TABLE`, that would reach a table inheriting from the one named (or a partition of it) that another owner holds, read from the database's catalog; `ALTER TYPE ... CASCADE`; a name looked up again after an earlier statement in the same migration dropped or renamed what it named; and, on MySQL and MariaDB, the `WAIT n` / `NOWAIT` and `IF EXISTS` spellings, `CONVERT TABLE ... TO PARTITION`, `CREATE OR REPLACE INDEX`, and a clause it cannot read (such as `CONVERT TO CHARACTER SET`) on a table another owner has a column, index or constraint on. A full plugin uninstall on PostgreSQL whose DOWN migrations hold an `INSERT`, `UPDATE` or `DELETE` is refused before anything runs, since a trigger may change tables. A column added earlier in the same migration is credited for a later change only when written `ADD COLUMN` or with a quoted name, outside any routine body.
