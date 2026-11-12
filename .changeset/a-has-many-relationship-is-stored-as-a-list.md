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

A hasMany relationship, or one naming several collections, that the Schema Builder creates is now stored as a list, with no foreign key to one row, so saving and reading several related entries works on PostgreSQL, MySQL and SQLite. Switching a relationship from one related entry to many keeps each value as a one-item list: on a collection or a Single through a Schema Builder save, a configuration reload, `db:sync`, a development start or a generated migration; on a field group or a translated field's translations through a Schema Builder save, a configuration reload or a generated migration. Switching from many to one converts when every row holds at most one, and is refused, naming the field and the rows, while a row holds more, or, for a required field, none. Switching to or from naming several collections is refused while a row holds a value, by the apply before anything changes and by a generated migration before any DDL. A change no road can carry is refused rather than leaving values in the old shape: a switch made while the field starts or stops being translated, a switch made in the same change that renames the field, a field group's switch through `db:sync`, and any switch when the registry recording what the field was cannot be read.

Migration snapshots now record each relation column's storage shape (`referenceShape`), which is how a generated migration sees a switch on SQLite, where every shape is text. The key is optional: a snapshot written before it plans what it planned before, so a switch made across such a snapshot is not converted by the file.

On PostgreSQL and MySQL, a hasMany column an earlier save created as a single reference, with a foreign key, is converted to a list by the next schema apply or by the next migration `migrate:create` generates.
