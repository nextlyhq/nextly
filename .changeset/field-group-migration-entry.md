---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Groundwork for the field group storage migration. The engine can now plan a complete run in either direction and resume one that was interrupted. A rename also carries the pointers that address the table it moves: a field group nested inside another records its parent by physical table name, so renaming the parent without rewriting those records would leave the nested content in place but unreachable, and reads would return nothing rather than fail.

Nothing runs it yet. No command invokes the migration and no database is changed by installing this; the entry point ships separately, once the engine is covered end to end against real PostgreSQL, MySQL and SQLite servers.
