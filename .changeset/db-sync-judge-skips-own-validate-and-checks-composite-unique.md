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

On SQLite, `nextly db:sync` judges a column's type change more closely in three cases.

- A field's own `validate` function is no longer asked of stored values. It is written for a whole entry and its request, and judging a value alone it could refuse one the field accepts, which a consent would then clear. The field's built-in rules (length, pattern, range, options, a plugin type's own validation) still judge every value, and the function judges at the entry's next write.
- A column in a unique index of several columns is checked before anything runs: two rows whose values the new type reads as one (the texts "1" and " 1" becoming a number) under the same values in the index's other columns block the change, naming the rows. Before, SQLite's rebuild converted the column and the index then failed.
- Where one run clears consented values in several columns and finds values written since the check, every column's consented values are cleared first, then one error names each column's rows. Before, the run stopped at the first column.

PostgreSQL and MySQL are unchanged: there the database refuses a change a unique index cannot hold, and the change is not made.
