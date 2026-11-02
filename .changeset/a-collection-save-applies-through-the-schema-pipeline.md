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

A Schema Builder save of a collection now changes the database in development through the same schema apply as the schema dialog, under the schema lock. What changes for a save:

- **The lock.** A save while `nextly migrate`, `db:sync`, a rename or another schema change holds the schema lock is refused with nothing written. A save that only changes labels or admin options never creates the lock's table where it is missing, since that is itself a schema change. The schema dialog's apply now takes the same lock, so it too is refused, with nothing written, while another schema change or a migration holds it.
- **The whole database.** The save compares every table the Builder owns with what was recorded for it, as the dialog does. A table changed outside the Builder refuses the save, naming that table and the step that brings it in step.
- **MySQL failures.** A statement MySQL refuses part-way through a save is reported as `NEXTLY_MIGRATION_APPLY_FAILED` with the database's own message, rather than "The database refused statement N of M of this schema change". MySQL keeps the statements that ran before it; saving again finishes the change from what the database holds. A failed apply from the schema dialog now carries the same code and message rather than a generic error.
- **Filling a Required field added over existing rows.** The rows get the field's default where it has one, and otherwise its type's empty value, written as a bound value rather than spliced into the statement. A date or date-time field takes the moment of the save, read once for every row, rather than the database's own clock. A plugin field type takes the empty value its plugin declares. The column keeps no default afterwards.
- **Unique turned off** drops the single-column unique index the field had, including one adopted from an earlier install.
- **An index name already taken** by another index on the table refuses the save before anything changes, naming that index, rather than leaving the field recorded unique with nothing enforcing it.
- **SQLite.** A table rebuild a failed save left part-way (a `__new_<table>` beside or instead of the table) is finished or undone before the next save.
- **MySQL indexes on long text.** An index added to an existing table on a TEXT column is keyed by its first 191 characters, as a new table's indexes already were, so MySQL accepts it. This applies to the schema dialog and to `migrate:create` files too.
- **Many-to-many junctions on MySQL** are created with their indexes inside the one `CREATE TABLE IF NOT EXISTS`, so a junction lands whole and a save retried after a part-way failure passes over it. Names are unchanged.
- **A column added outside the Builder** is no longer dropped when a save adds a field it could be mistaken for: the save is refused instead.
- **Schema version.** A save moves the collection's schema version on, so a schema dialog open beside it sees the change.

Production is unchanged: a save writes the migration file and runs nothing. On SQLite, that file still does not make a field leaving translation NOT NULL when it is Required or Unique, although the database in development does. A save's migration file stays one combined file with no localization intent header, so history inference and `nextly migrate`'s header-keyed checks don't read it.
