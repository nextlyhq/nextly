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

The first deploy of a project whose migrations the Schema Builder wrote, onto a database that holds nothing, is no longer refused for data-loss consent. `nextly migrate`, and a production start with `db.runMigrationsOnBoot`, answered "rows written to dynamic_collections may run code the table carries, which could not be read" for each Builder migration and applied nothing, on SQLite, PostgreSQL and MySQL, until the consent without targets was given, though the run deletes nothing. A write to one of Nextly's own tables that the database does not have yet is now read as running no code of that table, in a run that makes those tables before its first file. Everything else is judged as before: a table that is there, or whose existence cannot be read, any other table the database lacks, rows removed, and any row change after a file defines a trigger or a function. A first deploy whose files create a table with `CREATE TABLE IF NOT EXISTS` and then fill it, such as a translations table, still needs the consent on an empty database.
