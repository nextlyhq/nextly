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

A field moved into a group, or out of one, in the Schema Builder now keeps every entry's value. The Builder sends each move with the save (`hints.moves`: the field's path before and after), and the save's migration file copies the values into their new place before it drops the old column, or after it adds the new one. The file's way down copies them back, and puts each group back as it was: a container the way in made is removed once empty, and a group left with no keys is NULL again. The media library's record of where each item is used moves with the field's path, both ways, so the library goes on finding those uses. The review and the file's header name what the old column had that a group's JSON value cannot hold: its type, NOT NULL, indexes, comment, character set and collation.

A move that cannot keep its values is refused before anything is written, with a sentence saying why. That covers a unique field, a field whose translation would change, a move into a repeater or out of one, a field group or Blocks field, a move into a group created in the same save, a move out of a group deleted in the same save, and a date moved out of a group while some entry holds it in a form other than an ISO date, or an ISO date and time with its offset (such as `July 17, 2026`), which its column would not read as the same date; the refusal names those entries. On SQLite and MySQL, whose date columns keep whole seconds, a date with milliseconds is refused as well, and on MySQL, whose date column is a TIMESTAMP, a date outside 1970-01-01T00:00:01Z to 2038-01-19T03:14:07Z. On PostgreSQL and MySQL, a field moved out of a group is also refused, naming the entries, where some entry holds a value its new column would not keep as it is: a whole number outside -2147483648 to 2147483647, a decimal with more digits than its precision and scale (which the cast would round), a non-number in a number column, or a text longer than its column's width (a short text's `varchar`, MySQL's 65 535-byte `text`). On every dialect, a checkbox moved out of a group is refused where some entry holds a value other than true or false, which the copy would read as false. A move into a group is also refused for a field the admin settings name (`useAsTitle`, `defaultColumns`) or an enabled stored hook names (such as auto-slug's `sourceField`). A move out of a group is refused onto the `title` or `slug` every entry keeps while no field has that name, which the move would write over, and a move into a group off such a column, which the table then takes back for itself. A decimal whose precision or scale changes with the move is refused too. For now, a move in a translated collection is refused too.

On SQLite, a migration that moves dates out of a group stops before it changes anything when an entry of the database it runs on holds a date SQLite cannot keep. The error names the field: `NOT NULL constraint failed: nextly_unreadable_date_<field>.an_entry_holds_a_date_sqlite_cannot_keep`. Write that entry's date as an ISO date in whole seconds, then run the migration again.

On PostgreSQL and MySQL, the same migration also stops first, naming the field (`cannot_keep_<field>` in `nextly_unkept_<field>`), where an entry of the database it runs on holds a value its new column would not keep as it is: a number outside its range or past its decimal places, a text longer than its width, a checkbox value other than true or false, a date other than an ISO date or one with a time and its offset (or a day or time that does not exist), or on MySQL a date with milliseconds or outside its TIMESTAMP. On SQLite it stops so for a checkbox value. On every dialect it also stops first, naming the field (`needs_a_value_<field>`), where a field required where it moves out holds no value on some entry and the save fills none, and so does the way back from a move into a group where the column it restores is required. Change that entry's value, then run the migration again.
