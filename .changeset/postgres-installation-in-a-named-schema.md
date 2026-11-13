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

An installation on PostgreSQL can keep its tables in a schema other than `public`: set `db.postgres.schema` and every core, collection, Single, component and plugin table, and the migration history, is created and migrated there. Several installations can now share one database, each in a schema of its own. Until this release any schema but `public` was refused with `POSTGRES_SCHEMA_UNSUPPORTED`; that code is retired.

A start whose configured schema holds no installation, while another schema of the same database holds one, is refused with `POSTGRES_SCHEMA_MOVED`, naming both schemas, because it would otherwise create and serve a second, empty installation. Point `db.postgres.schema` back at the schema the installation is in, or set `NEXTLY_POSTGRES_SCHEMA_NEW_INSTALL=1` for the first start of a separate installation started on purpose. Existing installations in `public` see no change.
