---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

On PostgreSQL and SQLite, a Schema Builder save that changes a field's type writes each value as the new type reads it, rather than leaving the database's cast to reach it, for every pair of text, email, choice, number, list, date, checkbox, JSON and rich text: a list's one item becomes that item, a text naming an instant becomes a date. The preview answers how many values of each field are kept, changed and lost, with the first rows of those not kept (`typeChanges`), and the save may send them back (`confirmedTypeChanges`). Where any count differs, nothing is changed and the refusal carries the new ones (`TYPE_CHANGE_COUNTS_CHANGED`). A value that cannot convert is cleared only where its field's lost count was confirmed. Collections, Singles and field groups take the same confirmation.

On MySQL no value is rewritten yet, as a write made during the conversion could be lost: a change that would rewrite or clear a value is refused, as before, and one the database's cast reads alike runs.

The migration file the save writes marks the columns it converts, with the version of the conversion rules (`-- Converts values: rules 1; <table>.<column>`). `nextly migrate` converts each database's own values the same way before the file's statements change the column, and clears a value that cannot convert only under `--accept-data-loss` covering that column; `--dry-run` lists each converted column and how many of its values would be cleared. `nextly migrate:down` converts them back. A file without the mark keeps the database's cast. A marked file is refused before any statement where its rules are not known to this version (`CONVERSION_RULES_UNKNOWN`) or its snapshots do not both record its fields (`CONVERSION_SNAPSHOT_MISSING`).

Every value is judged again where it is converted, before any statement, and a conversion whose values were written to meanwhile stops before its column changes (`TYPE_CHANGE_VALUES_CHANGED`). A conversion is refused by name, on the save, on `nextly migrate` and `migrate:down` before a change's first file, over a table with update triggers, a CHECK constraint naming the column, a default or a collation the column would lose, values that read as one while the old field's Unique index still stands, rows of a required field left with no value, a Unique field becoming JSON on SQLite, a text that is itself JSON becoming a JSON field's string on PostgreSQL, a value to rewrite or clear in a field that starts or stops being translated in the same change, and on SQLite a table a view, trigger or expression index depends on, or a replaced column's NOT NULL, UNIQUE, CHECK, foreign key or generated column. A type change the save converts runs in its migration file, inside that file's transaction, rather than in the push; a save its push applies for another reason keeps the database's cast, judged as before, and no confirmation lets that cast clear a value.
