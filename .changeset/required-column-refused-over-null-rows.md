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

Making a column required is now refused, before anything runs, when rows of its table would hold no value in it, on every road that can do it: a Schema Builder save or apply for a collection, a Single or a field group, the development push (`next dev`, `nextly db:sync`), and `nextly migrate` applying a migration file. The refusal names the collection, Single, field group or table, the field or column, and how many rows are in the way; for a field group, each collection and Single whose rows those are.

- A save or a migration that fills those rows first is not refused: a value chosen in the Schema Builder or at the push's prompt, or (in a migration file) an earlier statement that writes to the table, after which the rows still empty are counted at the statement that makes the column required. On MySQL, a migration refused there names the statements that ran before it, and its attempt is recorded as failed, never as applied.
- A required field added in the Schema Builder or the push with a value for the existing rows is now added, filled, then made required; before, the fill ran before the column existed and the save failed.
- Every table is checked by `nextly migrate`, including one that is not a collection, Single or field group (a plugin's), which the refusal names by its table and column.
- A count that fails refuses the change before anything runs, naming the table, rather than leaving it to the database.
- The CLI ends these refusals with two new codes, `REQUIRED_COLUMN_HAS_NULLS` and `REQUIRED_COLUMN_UNCOUNTED`, each with its own docs page.
