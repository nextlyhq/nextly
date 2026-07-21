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

`nextly prune` gained a sweep for companion tables whose main table is already gone, to clear orphans left by earlier deletes. As with the rest of prune, they are listed by default and only dropped with `--force`. These tables have no registry entry naming their entity, and a slug cannot be recovered from the table name because entities may declare a custom `tableName`, so the sweep drops the table and leaves the shared translation archive untouched rather than purging rows on a guess.

On MySQL, disabling localization now works more than once. The archive table's setup DDL is re-applied before every disable, but its `CREATE INDEX` had no existence guard — MySQL has no `IF NOT EXISTS` for indexes — so every attempt after the first failed with `Duplicate key name`. The index is now declared inline in the `CREATE TABLE IF NOT EXISTS`, making the whole statement a no-op once the table exists. Existing databases are unaffected: their index is kept and the table is left untouched.

`db:sync` now reports orphaned singles and components. The orphan scan was gated on the config still declaring at least one entity of that type, so removing the last single or component from `nextly.config.ts` — the very action that strands its table — skipped the check and reported nothing. Collections were unaffected only because most configs still declare some. The scan now runs regardless of the count, in both `db:sync` and watch-mode re-syncs.

The CLI can now reach component tables. `db:sync` and `nextly prune` build their schema registry from the static system tables, which leaves `comp_` tables unaddressable by the ORM — so the orphan cleanup silently skipped every component table and dropped the parent anyway. Both commands now register each component's runtime schema, read from `dynamic_components`, before any cleanup runs. A component table that still cannot be addressed fails the delete when it holds rows for that entity, rather than being skipped.
