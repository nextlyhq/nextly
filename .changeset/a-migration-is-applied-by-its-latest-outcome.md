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

A migration's state is now read from its latest outcome alone, and an interrupted run leaves nothing half-recorded.

- `nextly migrate`, `migrate:down`, `migrate:status` and `migrate:resolve` read an app migration as applied or rolled back from the last run, rollback or `migrate:resolve` that recorded one. An attempt that failed or stopped afterwards no longer makes an applied migration read as pending, so it is never applied twice.
- A migration file run in a transaction on PostgreSQL or SQLite records its attempt and its outcome inside that transaction. When the process is killed, its connection drops or a statement fails, nothing of the file is left, not even a ledger row, and the next `nextly migrate` applies it from its start. A failed file of this kind is no longer listed as failed by `migrate:status`; the command that ran it reported the error.
- On MySQL, and for a file marked `-- nextly:no-transaction`, `migrate:down` now records that a rollback started before its first statement, as `nextly migrate` already did for a file. A rollback that stops part-way is shown by `migrate:status` as one that recorded no outcome, and the migration stays recorded applied.
- An attempt cleared by `migrate:resolve --failed-cleanup` is no longer read as a rollback, so clearing an attempt made after a migration was applied leaves it applied.
- A migration file with no snapshot whose statement fails now ends with "Migration <name> failed: <reason>", as a file with a snapshot does, rather than the database's bare message.
