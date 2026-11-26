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

`nextly migrate:check` now reports the changes `nextly migrate:create` would write, and both commands run without a database.

- One comparison serves `migrate:check`, `migrate:create`, `nextly migrate`, a production start and `migrate:fresh`: what the configuration, the plugins, the Schema Builder's definition file and the app's extension tables declare that the newest snapshot does not record. A change written in a file beside the main migration, such as a translated field's new column type, is now listed as that file (`~ translations column types dc_posts`), and a field moving to its per-language table as `~ translations table dc_posts`. A project whose first migration would hold only permissions now fails `migrate:check`. Permissions alone are counted as permission changes (`1 pending permission change detected.`), where they read as changes to the configuration.
- `migrate:check` lists every change, where it listed ten, and marks each one: `+` added, `-` removed, `~` changed. A list with tables in it now names the settings that changed as well.
- Neither command needs `DATABASE_URL`. The dialect comes from `--dialect`, then the newest migration, then `DB_DIALECT` or the scheme of `DATABASE_URL` read without connecting, then a question at a terminal. With none of these and no terminal, both refuse with the new `DIALECT_NOT_STATED` code, naming `--dialect`.
- `migrate:create --record-snapshot` refuses a `DATABASE_URL` that names a database of another dialect than the migrations are for, with the new `DATABASE_DIALECT_DIFFERS` code.
- A Schema Builder definition file that git ignores is refused by `migrate:check` with the new `BUILDER_DEFINITION_IGNORED` code, whether or not the checkout holds it. `migrate:create` writes from one that is there and warns, naming it.
- Over a snapshot written before snapshots recorded settings and permissions, both commands say "Settings not yet recorded in a migration". The check still passes, and `migrate:create` records them in its next migration.
- Over such a snapshot, or the one `migrate:baseline` writes, what a translations table holds is not recorded either: its columns, and its unique indexes. `migrate:check`, `nextly migrate` and a production start that runs migrations name what `nextly migrate` makes there in a notice ("Translations tables not recorded yet in a migration") and refuse none of it; `migrate:create` records it in its next migration. A change to the main table is refused as before.
- The same notice is given over any later snapshot, a template's too, for the column a repeater's or group's translated text is kept in, where an upgrade asks for it and nothing of its collection, Single or field group has changed, the Schema Builder's included: `nextly migrate` makes it, as before.
- With no database named, both commands refuse over any Schema Builder save this machine left part-way, since they cannot tell which database the save was for.
