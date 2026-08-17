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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

`nextly migrate:field-groups` renames field-group storage to its current names, and previews by default.

Field groups were called components once, and the old vocabulary is still in the database: the registry table, each field group's data table, and the column naming which field group a stored row belongs to. Nextly reads whichever generation a database holds, so nothing forces this — a site that never runs it keeps working. This is the command for tidying it up, one site at a time.

Running it with no flags writes nothing and prints the plan. Applying is `--apply`, which requires `--backup-confirmed` alongside it, and `--down` rolls a completed migration back. A preview takes no lock and issues no DDL, so it can be run with a read-only credential.

The preview reports three things separately, because they answer different questions: every storage object that would be renamed, listed by name rather than counted; whether the plan was checked against your database or merely proposed, since another run writing at the same time makes the list an upper bound; and what could be seen of the migration lock, where "nothing is running" and "the lock could not be read" are reported as the different answers they are.

A new guide, Field group storage migration, covers the per-site runbook, how to read the preview, and rollback.
