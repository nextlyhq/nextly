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

A production start waits on the database far fewer times. It read the Schema Builder's registries four or five times each, and asked the database's catalog the same questions from several steps, one after another (on SQLite once per field group), so a start against a database 100 ms away spent about 4.5 seconds waiting before Nextly served. It now reads the catalog and each registry once, sends the reads that need nothing else together, and runs the independent steps after them together: about 12 waits on PostgreSQL and MySQL and 18 statements on SQLite, the same for 5 entities and for 50, outside the migrations at start and the plugins' own start-up code.

A production start no longer writes to `nextly_meta` to discard a setup token when none is stored, and the email templates' reconciliation no longer runs an update when no row needs it, so a start of a set-up site writes nothing of its own.

Each plugin's own start-up time (its `init` and `onReady`) is logged at debug level after the plugins start, and a warning names every plugin whose start-up took longer than 500 ms, with its time: every cold start waits for it before Nextly serves.

On SQLite, the catalog is read through SQLite's table-valued PRAGMA functions, a few statements whatever the number of tables, wherever Nextly reads it (migrations and `nextly migrate:create` included).
