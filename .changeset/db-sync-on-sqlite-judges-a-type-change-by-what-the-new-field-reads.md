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

On SQLite, `nextly db:sync` judges a column's type change by what the new field reads from each stored value, as a Schema Builder save does, and no longer only by whether SQLite keeps the value.

SQLite keeps any value in any column, so a change was called safe even where the new field could not read what was stored. Now:

- A value the new field cannot read makes the change lossy: it runs only under the consent naming the column (`--accept-data-loss=table.column`), which clears the named rows. A text "maybe" under a field that becomes a checkbox is one.
- A value the new field could hold only rounded, or only after being rewritten, blocks the change before anything runs, naming the rows. 1.5 under a field that becomes a whole number, and the text "true" under one that becomes a checkbox, are two.
- Where the new column is unique (by its field, or by a single-column unique index) and two values that would be cleared are the same, the change is blocked, naming the rows: make them differ or clear them first.
- A change every value survives goes ahead as before: a text whose every value is a number becomes a number.

A project whose `db:sync` converted such a column without a word is now asked or refused. Correct or clear the named values, then run it again.

SQLite converts a column outside a transaction. If a value the new field cannot read is written while that runs, the run clears the consented rows that still hold a value to clear and then ends with an error naming the rows written since: the column was converted, and those values are yours to correct or clear.

PostgreSQL and MySQL are unchanged. So is a `next dev` reload, which holds a column's type change for review on every database, as before. So is a change that keeps the SQLite column as it is (a long text becoming a short one), and a column of an entity the registry holds no earlier record of, which is judged as before.
