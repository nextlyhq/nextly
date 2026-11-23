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

`nextly migrate:check` now reports exactly the changes `nextly migrate:create` would write, and both commands run without a database.

- One comparison serves `migrate:check`, `migrate:create`, `nextly migrate`, a production start and `migrate:fresh`: what the configuration, the plugins, the Schema Builder's definition file and the app's extension tables declare that the newest snapshot does not record. A change only a file beside the main migration carries, such as a translated field's new column type, now fails `migrate:check` as it should, and the check names each change as `nextly migrate` names it (`+` added, `-` removed, `~` changed).
- Neither command needs `DATABASE_URL`. The dialect comes from `--dialect`, then the newest migration file's `-- Dialect:` header, then `DB_DIALECT` or the scheme of `DATABASE_URL` read without connecting, then a question at a terminal. With none of these and no terminal, both refuse with the new `DIALECT_NOT_STATED` code, naming `--dialect`.
- A Schema Builder definition file that git ignores is refused by `migrate:check` with the new `BUILDER_DEFINITION_IGNORED` code, naming the file; `migrate:create` writes from it and warns, naming it.
- Over a snapshot written before snapshots recorded settings and permissions, both commands say "Settings not yet recorded in a migration". The check still passes, and `migrate:create` records them in its next migration.
- With no database named, `migrate:check` refuses over any Schema Builder save this machine left part-way, since it cannot tell which database the save was for.
