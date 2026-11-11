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

`nextly repair-columns --apply` converts each column whose stored values all convert exactly, and records each repair. It takes the schema lock (waiting about 60 seconds for another schema change, then stopping with exit 1 and naming what holds it), classes every column again from the rows it holds now, and converts the safe ones towards their field as last migrated. A column that is pending a migration, owned by a plugin, blocked or lossy is left unchanged and reported with its reason, and one column's failure stops neither the others nor the report.

On PostgreSQL and SQLite each column converts with its record in one transaction, judged again after its table is closed, so it is converted whole or left exactly as it was. On MySQL each statement runs in strict mode and states how it runs while others use the table (`ALGORITHM` and `LOCK`), so MySQL refuses a change it cannot run as the report said; a conversion of several steps records its progress, and the next `--apply` finishes it from the step the live column has reached, which a dry run also reports. A conversion waits about 5 seconds for a table another session is using, then leaves the column as it was and reports it as unavailable, locked. Repairs are kept in a new `nextly_column_repairs` table, which only the first `--apply` that converts a column creates.
