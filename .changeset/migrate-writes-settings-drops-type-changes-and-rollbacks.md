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

`nextly migrate` now carries every settings change a migration records into the registry rows, and `nextly migrate:down` undoes only what the rolled-back migrations changed there.

- A field's help text, placeholder, hidden switch and its other admin options change no column, so they never reached a deployed registry row. They are now compared and written, by `nextly migrate` and by the development start alike, which share one comparison.
- A description or admin block a Schema Builder entity's migration clears is now cleared in the registry. A setting no migration ever recorded for that entity is still left as it is stored.
- The registry row of a collection, Single or field group that an applied migration drops (its snapshot no longer records an entity the one before it did, and its table is gone) is removed, on the run that applies the drop or on any later run. A row of an entity no snapshot records, or whose table still stands, is left as it is.
- A migration that changes a field's type now writes that entity's registry row with its file: inside the file's transaction on PostgreSQL and SQLite, so the conversion and the row commit together, and right after the file's last statement and before it is recorded applied on MySQL or in a file marked to run outside a transaction. `nextly migrate`, the boot migrate step and `nextly migrate:down` all do this, so no later file in the run sees the old type.
- `nextly migrate:down` to a point whose snapshot records the registry brings each row that snapshot records back to it, settings included, so rolling back a settings-only migration undoes it, and removes the row of an entity a rolled-back migration added. Rows nothing in the rolled-back migrations touched are left as they are. A rollback to a point whose snapshot predates recorded settings changes no row.

### Compatibility

Registry writes in production move to `nextly migrate`: deploy a settings change, a dropped entity or a type change by running `nextly migrate`, which now writes what a production start no longer writes. A deployed field whose help text or placeholder differed from the code is rewritten once, at the first development start or `nextly migrate` after upgrading.
