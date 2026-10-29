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

A read or write of a collection or Single that the database has not been migrated for now says so, instead of answering every request with a 500 "An unexpected error occurred." This covers three cases: a declared field's column is missing, the entity's table is missing, or the running server never registered the entity (for example, a migration added it after the server started). The answer is a 409 with the code `ENTITY_NOT_MIGRATED`. Its message names the collection or Single, the field or the table, and `nextly migrate`, and it never carries SQL or the database's own wording. `error.data` carries `reason` (`column`, `table` or `unregistered`), `kind`, `slug`, `table` and, for a missing column, `field`. This holds on PostgreSQL, MySQL and SQLite, through the REST API and the Direct API.

The database adapters now refuse a call on a table their schema registry does not hold with the code `NEXTLY_TABLE_NOT_REGISTERED` (exported as `TABLE_NOT_REGISTERED_CODE`, with `tableNotRegisteredError`, from `@nextlyhq/adapter-drizzle/types`). The message still says "not found in schema registry", now names what is missing instead of `setTableResolver()`, and carries the code.

**Compatibility:** a client that recognised these failures as a 500 `INTERNAL_ERROR` now receives a 409 `ENTITY_NOT_MIGRATED`.
