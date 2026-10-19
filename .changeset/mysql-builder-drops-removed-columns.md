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

On MySQL, removing a field in the Schema Builder now drops its column.

The Builder's ALTER generator wrote `ALTER TABLE … DROP COLUMN IF EXISTS`, a form MySQL does not accept (MariaDB does). On MySQL the drop failed, the column stayed, and a Required field's column, NOT NULL, refused every later entry, both for collections and for Singles. The same statement went into the migration file, where `nextly migrate` failed on it. PostgreSQL keeps `IF EXISTS`; MySQL and SQLite get the plain `DROP COLUMN`.

Columns that an existing MySQL install kept from fields removed before this fix are not dropped by it: a save drops only the columns of the fields it removes. They stay, with their data, until removed on purpose.

A collection save in the Schema Builder now applies whole or fails whole on PostgreSQL and SQLite, and says why on every database.

- Before anything runs, the save checks the entries: a field made Unique over repeated values, a new Unique field whose backfill would repeat, and a text field narrowed below a value an entry holds are refused, naming the field. A refusal never shows a stored value.
- The migration runs before the file and the registry are written. On PostgreSQL and SQLite it runs in one transaction, so a refusal changes nothing. On MySQL, which commits each schema statement, the refusal says which statement stopped it. Saving again finishes the change for what such a refusal most often leaves behind: a column already added or already removed, Draft/Published already turned on or off, a plain or unique index already created or dropped, and a translated field's companion column already added.
- Turning Unique on or off for an existing field now creates or drops its unique index. Before, only the registry changed, so a field could be recorded unique while the table accepted repeats.
- A new field whose name matches a column of another type already on the table is refused, naming the column, instead of being recorded over it.
