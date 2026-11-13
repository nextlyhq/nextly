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

A production start no longer creates or changes a table. Every start used to create the tables its configuration declared and the database lacked (a collection's, a Single's, a field group's, a translated entity's translation table, the user fields' columns), rename a table whose `dbName` changed, add a plugin's field to a Schema Builder entity, create a missing PostgreSQL schema, and set up every table of an empty database, in production too and with no lock between cold starts. A production start now serves the structure `nextly migrate` made: a missing translation table answers that its translations are not ready, and a field the database lacks answers `ENTITY_NOT_MIGRATED`. A development start (`next dev`) is unchanged.

A production start against a database with no Nextly tables, or without its configured PostgreSQL schema, creates nothing and refuses to start with `NEXTLY_DATABASE_NOT_SET_UP`, telling you to run `nextly migrate`. With `db.runMigrationsOnBoot`, the start runs that step first, which sets the database up as the command does.

A changed `dbName` now needs a migration. `nextly migrate:create` writes it as a dropped table and a new one, so until it writes a table rename, replace those statements with a rename by hand, as the production migrations guide shows. A site whose production tables were made by its starts, with no migration for them, takes a baseline (`nextly migrate:baseline`) before upgrading.
