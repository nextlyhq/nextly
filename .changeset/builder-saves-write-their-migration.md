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

A Schema Builder save of a collection now writes the migration and snapshot `nextly migrate:create` would write for that collection into your migrations folder (`db.migrationsDir`), after recording its whole definition in `db.uiSchemaFile`. In development the save runs that file the way `nextly migrate` does and records it applied with its checksum, so `nextly migrate` and `migrate:create` have nothing left to do. Outside development the save writes the definition, the file and the snapshot, runs nothing, and the deploy's `nextly migrate` applies them.

- Every save of a collection does this: a create, a field change from the Builder's schema dialog, and a delete, whether made in the admin, through a plugin's `ctx.services.collections`, or through the `CollectionsHandler`. Nothing is written to `src/db/migrations/dynamic` any more. Files an earlier version wrote there are not read; delete the folder once you no longer need it.
- A save first runs the checks `nextly migrate` runs before it writes anything. While an applied migration file is edited or missing, or an attempt is unfinished, the save is refused with `NEXTLY_MIGRATION_HISTORY_REFUSED` (409) and the text `nextly migrate` prints, and nothing is written. A delete is refused before anything is torn down.
- The answers you give in the schema dialog are part of the file, so every database it reaches is settled the same way: a rename keeps the column's values; rows that do not fit a field made required are filled with the value you gave, or deleted where you chose that, before the column becomes NOT NULL. The preview names each fill and each delete, and `nextly migrate` asks consent (`--accept-data-loss`) before running such a delete on a database whose rows it would remove. A unique field takes no single fill value, and a delete of 10,000 rows or more is refused, as before.
- On a translated collection, a field change, or turning translation on or off, keeps the development push it has always had; its migration is written as well and recorded applied once the push has run, and the save is refused, naming the file, where the database does not stand as the file says.
- `nextly migrate:create` now writes a translated field's accepted rename as a rename of its column in the translations table, so its values stay under the new name; before, it added the new column and left the values under the old one.
- The first save of a collection whose table no snapshot records (one an earlier version made) writes `<timestamp>_<slug>_adopt.sql`, describing the table exactly as your database has it and recorded applied without running, before the save's own file, so a fresh database replays the collection.
- On MySQL, a text field an earlier Builder made as `TEXT` is converted to `varchar(255)`, the type every other path uses, by a `<timestamp>_<slug>_convert.sql` that runs before the change. The preview names each conversion, and a save converts no column it was not shown: a save through the API or a plugin passes the confirmed columns as `acknowledgedConversions`, and is otherwise refused with `NEXTLY_SCHEMA_CONVERSION_UNCONFIRMED` (409). A stored value too long for the new type is refused by MySQL, and nothing is applied.
- A many-to-many relationship's junction table, and a relationship column's foreign key with its `onDelete` and `onUpdate`, are written into the save's file as the Builder has always created them, so a deploy replays them too. Snapshots keep leaving both out, as before, so `migrate:check` reports no drift for them.
- A save whose statements fail with nothing applied leaves no file and puts the definition back. One that fails part-way (MySQL commits each schema statement) keeps its files for `nextly migrate:resolve`, with `NEXTLY_MIGRATION_PARTIALLY_APPLIED`.
- The definition file (`ui-schema.json`) now holds a field's `options` exactly as the registry stores them, such as a relationship's `target`, `relationType`, `onDelete`, `onUpdate` and `junctionTable`, a text's `variant` or a number's `format`, beside `relationTo` and `hasMany`. The key is optional, so every existing file stays valid.
- On MySQL, a migration that makes a column required needs `--accept-data-loss` on deploy, as any such file `migrate:create` writes does: its statement restates the column, and `nextly migrate` cannot read what it removes.
