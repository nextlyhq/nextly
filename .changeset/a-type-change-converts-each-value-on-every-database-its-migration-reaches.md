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

A Schema Builder save that changes a field's type writes each value as the new type reads it, rather than leaving the database's cast to reach it: a list's one item becomes that item, a whole number held as text becomes a number. A value that cannot convert is cleared only where the save confirms the count its review showed; a Single's and a field group's save take that confirmation as a collection's does.

The migration file the save writes marks the columns it converts, with the version of the conversion rules (`-- Converts values: rules 1; <table>.<column>`). `nextly migrate` converts each database's own values the same way before the file's statements change the column, and clears a value that cannot convert only under `--accept-data-loss` covering that column; `--dry-run` lists each converted column and how many of its values would be cleared. A file without the mark keeps the database's cast, and one whose mark names rules this version does not know is refused (`CONVERSION_RULES_UNKNOWN`).

Every value is judged again where it is converted, before any statement: a value written after the save's review is converted with the rest, and one that changes the count to clear refuses the change with nothing changed (`TYPE_CHANGE_VALUES_CHANGED` where it was written during the conversion itself). A conversion is refused, naming why, over a table with update triggers, over values that read as one while the old field's Unique index still stands, into a required field, and on SQLite over a translations table a view, trigger or expression index depends on. A column's default and, where values are cleared, its NOT NULL no longer stop the conversion on PostgreSQL and MySQL. A type change the save converts runs in its migration file, inside that file's transaction, rather than in the push; a save its push applies for another reason keeps the database's cast, judged as before.
