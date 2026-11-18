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

`nextly repair-columns` reports a table or collection whose migration is still to come, where it used to say nothing or the wrong thing:

- A collection, Single or field group that no migration has applied yet has every column reported as pending a migration, even where a development push already made the table as configured. The run exits 2, not 0 with "Every column matches its field."
- A `dbName` change not yet migrated is read at the table the database still holds. Each column is reported once as pending, "moves from <old table>", and a legacy column on the old table is still found and repaired by `--apply`. In the JSON report, `pending` gains `renamedFrom`: the old table on a rename, otherwise `null`.
- An entity removed from the configuration or a plugin, or left out of a checked-out `ui-schema.json`, has each of its columns reported as pending removal. With no `ui-schema.json` in the project, a Schema Builder entity is read from its registry row as before. Where a removed entity has no migration snapshot, a column's type is not judged: its column overrides went with its declaration, so the column may be as applied.
- Without a migration snapshot, a registry row says what was applied only where a sync or a migration finished it (`applied` or `synced`). A `pending`, `generated` or `failed` row no longer does.
- A registry row that names no table, or that is marked as diverged, stops the run (exit 1), naming the row, as an unreadable applied migration snapshot already does.
