---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

A Single's schema save applies whole or fails whole on PostgreSQL and SQLite, and says why on every database, as a collection's save does.

- A change the value the Single holds cannot take (a text field narrowed below it, a field made unique over a repeated value) is refused before any statement runs, naming the field. PostgreSQL used to cut a longer value to fit.
- The migration runs in one transaction on PostgreSQL and SQLite. A statement the database refuses fails the save with the reason and the Single keeps the fields it had, where it used to be recorded as a failed migration beside the new fields. On MySQL, which commits each schema statement, the refusal says how many statements ran, and saving again finishes the change.
