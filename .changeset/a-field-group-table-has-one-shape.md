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

A field group's table now has one shape whoever builds it, and a Schema Builder save no longer rewrites columns it does not change.

- The table the Builder's create makes and the one a `migrate:create` file makes now agree. The first Builder save of a field group used to drop the `_order`, `created_at` and `updated_at` defaults and add a `created_at` index. On MySQL a save could also turn a text field's `text` column into `varchar(255)`, which MySQL refuses once a value is longer, and `created_at`/`updated_at` from `datetime` into `timestamp`.
- When upgrading: a field group made by a migration file gets those three column defaults with its next migration (no data changes), and one made by the Builder gets the `created_at` index with its next save.
- `migrate:create` describes a Builder Single's or field group's table as the Builder made it, so on MySQL its unbounded text stays `text`.
- On MySQL a migration that sets a column's default to a function, such as `CURRENT_TIMESTAMP`, now runs; it was a syntax error.
- A development save no longer loses a unique index that holds a field's uniqueness under a name other than the one the schema declares.
