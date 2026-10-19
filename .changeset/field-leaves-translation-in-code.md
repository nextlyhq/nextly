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

A translated field made shared in code now keeps its content through
`nextly migrate:create`. Until now the migration only added the shared
column, empty, and left every language in a translated column that nothing
dropped or read again. `migrate:create` now writes two more files around
the main migration. The first writes the other languages to the
localization archive before anything changes. The second copies the
default language's value into the new shared column and removes the
translated column. Rolling back with `nextly migrate:down` puts the
translated field back, every language included, and every file is safe to
run again.

The same rule as the Schema Builder refuses, at `migrate:create`, a field
that stops being translated while it is `required`, `unique` or covered by
a unique index, or while it also changes type, and names the steps that
work. The type it is stored in now is read from the migration history,
which records each translated column; a field no migration file describes
is reported instead.

`nextly migrate --dry-run` now prints the SQL each pending file would run,
as `migrate:down --dry-run` already does for a rollback.

On MySQL, a failed file of this kind is refused rather than run again, as
before, and the refusal now names the file and columns and says how to tell
whether the drop landed.
