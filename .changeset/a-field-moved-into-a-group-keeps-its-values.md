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

A field moved into a group, or out of one, in the Schema Builder now keeps every entry's value. The Builder sends each move with the save (`hints.moves`: the field's path before and after), and the save's migration file copies the values into their new place before it drops the old column, or after it adds the new one. The file's way down copies them back. The review and the file's header name what the old column had that a group's JSON value cannot hold: its type, NOT NULL, indexes, comment, character set and collation.

A move that cannot keep its values is refused before anything is written, with a sentence saying why. That covers a unique field, a field whose translation would change, a move into a repeater or out of one, a field group or Blocks field, a move into a group created in the same save, a move out of a group deleted in the same save, and a date moved out of a group while some entry holds it in a form other than an ISO date, or an ISO date and time with its offset (such as `July 17, 2026`), which its column would not read as the same date; the refusal names those entries. On SQLite and MySQL, whose date columns keep whole seconds, a date with milliseconds is refused as well, and on MySQL, whose date column is a TIMESTAMP, a date outside 1970-01-01T00:00:01Z to 2038-01-19T03:14:07Z. On PostgreSQL and MySQL, a whole number moved out of a group is refused, naming the entries, where some entry holds one outside -2147483648 to 2147483647, the range its integer column holds. A move into a group is also refused for a field the admin settings name (`useAsTitle`, `defaultColumns`) or an enabled stored hook names (such as auto-slug's `sourceField`). A move out of a group is refused onto the `title` or `slug` every entry keeps while no field has that name, which the move would write over. A decimal whose precision or scale changes with the move is refused too. For now, a move in a translated collection is refused too.

On SQLite, a migration that moves dates out of a group stops before it changes anything when an entry of the database it runs on holds a date SQLite cannot keep. The error names the field: `NOT NULL constraint failed: nextly_unreadable_date_<field>.an_entry_holds_a_date_sqlite_cannot_keep`. Write that entry's date as an ISO date in whole seconds, then run the migration again.

On MySQL, such a migration stops part-way when an entry of the database it runs on holds a date its TIMESTAMP column does not hold: the new column stays added, every entry keeps its date in the group, and `nextly migrate:resolve` settles the file.
