---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Deleting a collection, single, or component now removes all of its data instead of leaving parts behind.

Three kinds of leftovers were possible. Localized entities keep translations in a companion `<table>_locales` table and archived translations in the shared `nextly_i18n_archive`; neither was cleaned up. Embedded component values live as rows in `comp_<slug>` linked to the parent by plain string columns with no foreign key, so dropping the parent table cascaded nothing and stranded every instance, along with its own translations and any components nested inside it. Deleting a component now also sweeps components nested within it.

Singles were worse still. Their data table was dropped without `CASCADE`, so on PostgreSQL and MySQL the companion's foreign key made the drop fail. The error was logged and swallowed, and the registry row was deleted anyway, leaving both tables stranded with nothing pointing at them. The drop now cascades and its failures propagate, so a delete that cannot finish leaves the single intact and retryable rather than half-removed.

`nextly prune` gained a sweep for companion tables whose main table is already gone, to clear orphans left by earlier deletes. As with the rest of prune, they are listed by default and only dropped with `--force`.

On MySQL, disabling localization now works more than once. The archive table's setup DDL is re-applied before every disable, but its `CREATE INDEX` had no existence guard — MySQL has no `IF NOT EXISTS` for indexes — so every attempt after the first failed with `Duplicate key name`. The index is now declared inline in the `CREATE TABLE IF NOT EXISTS`, making the whole statement a no-op once the table exists. Existing databases are unaffected: their index is kept and the table is left untouched.
