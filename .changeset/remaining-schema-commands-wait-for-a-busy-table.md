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

`nextly migrate:field-groups --apply` now waits for a table another database session is using in short tries, within `NEXTLY_LOCK_TIMEOUT` and `NEXTLY_LOCK_TIMEOUT_TOTAL`, and stops with `NEXTLY_TABLE_BUSY` once they run out, as `nextly migrate` does; the next run resumes from the step that stopped. Around the busy-table tries:

- `--quiet` now keeps back each try's notice on `nextly migrate`, `migrate:fresh`, `prune` and the plugin commands; the final stop is still shown.
- An app migration stopped by a busy table names the plugin migrations the same run applied before it.
- On MySQL, a schema sync's try also bounds waits for locked rows, and puts both lock settings back to what the connection had.
- A schema sync whose earlier tries committed part of the change on MySQL or SQLite reports every statement and change it made, not only the last try's.
- A Schema Builder save whose translations table stays busy answers 409 with the busy-table report instead of a 500.
- A user field taken back after a busy-table stop no longer lingers in the user model.
- An invalid `NEXTLY_LOCK_TIMEOUT` stops the development start's extension-table pass before it creates a table.
- `db:sync --remove-orphaned` drops an orphan's table before its registry entry, so a drop that stops on a busy table is found again by the next sync.
