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

The first deploy of a project whose migrations include a Schema Builder translation change, onto a database that holds nothing, is no longer refused for data-loss consent. The save that turns a collection's translation on creates its translations table with `CREATE TABLE IF NOT EXISTS` and then fills it; `nextly migrate`, and a production start with `db.runMigrationsOnBoot`, answered "rows written to <table>\_locales may run code the table carries, which could not be read" and applied nothing, on SQLite, PostgreSQL and MySQL. A table a migration creates only if absent is now the run's own where it is sure to be created: no table, view or other relation has the name before the run, and no earlier statement of the run names it. Otherwise it is judged as before, so a `CREATE TABLE IF NOT EXISTS` over an existing table or view, or after a rename onto the name, never hides a deletion. `migrate:check` and `migrate:create`, which read no database, keep naming such a table's deletions.
