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

A hasMany relationship, or one naming several collections, that the Schema Builder creates is now stored as a list, with no foreign key to one row, so saving and reading several related entries works on PostgreSQL, MySQL and SQLite. Switching a relationship from one related entry to many keeps each value as a one-item list; switching from many to one converts when every row holds at most one, and is refused, naming the field and the rows, while a row holds more. Switching to or from naming several collections is refused while a row holds a value. On PostgreSQL and MySQL, a hasMany column an earlier save created as a single reference, with a foreign key, is converted to a list by the next schema apply or by the next migration `migrate:create` generates.
